import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { discoveredVideos, nicheKeywords, projects, videoProjects } from "../db/schema";
import { PermanentError } from "../services/errors";
import { getLlm, getYoutube, hasLlm } from "../services/registry";
import type { YoutubeVideo } from "../services/types";
import type { JobHandler } from "./context";
import { type AiFactors, scoreVideo } from "./scoring";

const payloadSchema = z.object({
  projectId: z.string(),
  query: z.string().optional(),
  channelId: z.string().optional(),
  youtubeId: z.string().optional(),
  publishedAfterDays: z.number().optional(),
  duration: z.enum(["any", "short", "medium", "long"]).optional(),
});

const aiSchema = z.object({
  videos: z.array(
    z.object({
      id: z.string(),
      relevance: z.number(),
      hook: z.number(),
      educational: z.number(),
      storytelling: z.number(),
      shortForm: z.number(),
      reason: z.string(),
      tags: z.array(z.string()).default([]),
      suggestedMode: z.enum(["clipper", "faceless"]),
    }),
  ),
});

export const discoverySearch: JobHandler = async (ctx) => {
  const payload = payloadSchema.parse(ctx.job.payload);
  const { db, workspaceId } = ctx;
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, payload.projectId), eq(projects.workspaceId, workspaceId)));
  if (!project) throw new PermanentError("Project not found", "not_found");

  const keywords = await db
    .select()
    .from(nicheKeywords)
    .where(and(eq(nicheKeywords.projectId, project.id), eq(nicheKeywords.workspaceId, workspaceId)));
  const excluded = keywords.filter((k) => k.excluded).map((k) => k.keyword.toLowerCase());
  const query = payload.query ?? (keywords.find((k) => !k.excluded)?.keyword || project.niche);

  const youtube = getYoutube();
  let found: YoutubeVideo[];
  if (payload.youtubeId) {
    const video = await youtube.getVideo(payload.youtubeId, { signal: ctx.signal });
    if (!video) throw new PermanentError("YouTube has no video with that link.", "not_found");
    found = [video];
  } else {
    found = await youtube.search(
      {
        query: payload.channelId ? payload.query : query,
        channelId: payload.channelId,
        language: project.language,
        regionCode: project.region ?? undefined,
        duration: payload.duration,
        publishedAfter: payload.publishedAfterDays ? new Date(Date.now() - payload.publishedAfterDays * 86_400_000).toISOString() : undefined,
        maxResults: 15,
      },
      { signal: ctx.signal },
    );
  }
  const videos = found.filter((video) => {
    const haystack = `${video.title} ${video.description}`.toLowerCase();
    return !excluded.some((word) => haystack.includes(word));
  });
  await ctx.log(`Found ${found.length} videos for "${payload.youtubeId ?? query}", ${found.length - videos.length} removed by excluded keywords.`);
  await ctx.progress(0.4);
  if (videos.length === 0) return { found: 0, added: 0 };

  const known = await db
    .select({ youtubeId: discoveredVideos.youtubeId })
    .from(discoveredVideos)
    .where(and(eq(discoveredVideos.projectId, project.id), inArray(discoveredVideos.youtubeId, videos.map((v) => v.youtubeId))));
  const knownIds = new Set(known.map((row) => row.youtubeId));

  const aiById = new Map<string, z.infer<typeof aiSchema>["videos"][number]>();
  if (hasLlm()) {
    const result = await getLlm().generateJson(
      {
        system:
          "You assess YouTube videos as inspiration for short-form content in a given niche. Score from 0 to 100, based only on the metadata given. Don't estimate future view counts. suggestedMode: 'clipper' if the footage itself would be the value and the user could get rights to it, 'faceless' if the topic could be explained in an original narrated video.",
        user: JSON.stringify({
          niche: project.niche,
          audience: project.targetAudience,
          outputShape: "{ videos: [{ id, relevance, hook, educational, storytelling, shortForm, reason (one sentence), tags (up to 4), suggestedMode }] }",
          videos: videos.map((v) => ({ id: v.youtubeId, title: v.title, channel: v.channelTitle, description: v.description.slice(0, 400), seconds: v.durationSeconds })),
        }),
        schema: aiSchema,
      },
      { signal: ctx.signal, onUsage: ctx.usage },
    );
    for (const entry of result.videos) aiById.set(entry.id, entry);
  } else {
    await ctx.log("No OpenAI key, so scores use metadata factors only and are marked partial.", "warn");
  }
  await ctx.progress(0.8);

  const existingTitles = (
    await db
      .select({ title: videoProjects.title })
      .from(videoProjects)
      .where(and(eq(videoProjects.projectId, project.id), eq(videoProjects.workspaceId, workspaceId)))
  ).map((row) => row.title);

  for (const video of videos) {
    const ai = aiById.get(video.youtubeId);
    const breakdown = scoreVideo(video, existingTitles, (ai as AiFactors | undefined) ?? null);
    const row = {
      title: video.title,
      channelTitle: video.channelTitle,
      channelId: video.channelId,
      description: video.description,
      thumbnailUrl: video.thumbnailUrl,
      durationSeconds: video.durationSeconds,
      publishedAt: video.publishedAt ? new Date(video.publishedAt) : null,
      viewCount: video.viewCount,
      likeCount: video.likeCount,
      commentCount: video.commentCount,
      opportunityScore: breakdown.total,
      scoreBreakdown: breakdown,
      topicTags: ai?.tags ?? [],
      suggestedMode: ai?.suggestedMode ?? null,
    };
    await db
      .insert(discoveredVideos)
      .values({ workspaceId, projectId: project.id, youtubeId: video.youtubeId, rightsStatus: "metadata_only", ...row })
      .onConflictDoUpdate({ target: [discoveredVideos.projectId, discoveredVideos.youtubeId], set: row });
  }
  const added = videos.filter((video) => !knownIds.has(video.youtubeId)).length;
  await ctx.log(`Saved ${added} new results and refreshed ${videos.length - added} existing ones.`);
  return { found: videos.length, added };
};
