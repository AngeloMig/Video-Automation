import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { mediaAssets, projects, projectSettings, sourceAssets, transcripts, videoProjects } from "../db/schema";
import { enqueue } from "../jobs/queue";
import { extractSpeechAudio } from "../media/ffmpeg";
import { PermanentError } from "../services/errors";
import { getLlm, getStorage, getStt } from "../services/registry";
import { buildClipTimeline, getTemplate } from "../timeline/build";
import type { JobHandler } from "./context";
import { normalizeHighlights } from "./scoring";

const transcribePayload = z.object({ sourceAssetId: z.string(), minSeconds: z.number().default(20), maxSeconds: z.number().default(60), clipCount: z.number().default(5) });

async function loadSource(ctx: Parameters<JobHandler>[0], sourceAssetId: string) {
  const [row] = await ctx.db
    .select({ source: sourceAssets, media: mediaAssets })
    .from(sourceAssets)
    .innerJoin(mediaAssets, eq(mediaAssets.id, sourceAssets.mediaAssetId))
    .where(and(eq(sourceAssets.id, sourceAssetId), eq(sourceAssets.workspaceId, ctx.workspaceId)));
  if (!row) throw new PermanentError("Source video not found", "not_found");
  return row;
}

export const clipTranscribe: JobHandler = async (ctx) => {
  const payload = transcribePayload.parse(ctx.job.payload);
  const { source, media } = await loadSource(ctx, payload.sourceAssetId);
  const stt = getStt();

  const inputPath = join(ctx.tmpDir, media.storageKey.split("/").pop() ?? "source");
  await getStorage().downloadTo(media.storageKey, inputPath);
  await ctx.progress(0.15);

  const audioPath = join(ctx.tmpDir, "speech.mp3");
  await extractSpeechAudio(inputPath, audioPath, ctx.signal);
  await ctx.progress(0.3);

  const result = await stt.transcribe(audioPath, { signal: ctx.signal, onUsage: ctx.usage });
  await ctx.log(`Transcribed ${result.words.length} words with ${stt.name}.`);

  const values = {
    workspaceId: ctx.workspaceId,
    sourceAssetId: source.id,
    provider: stt.name,
    language: result.language ?? null,
    text: result.text,
    words: result.words,
    segments: result.segments,
  };
  await ctx.db.transaction(async (tx) => {
    await tx
      .insert(transcripts)
      .values(values)
      .onConflictDoUpdate({ target: transcripts.sourceAssetId, set: values });
    await enqueue(tx, {
      workspaceId: ctx.workspaceId,
      projectId: source.projectId,
      agent: "clipping",
      kind: "clip.detect",
      label: `Find highlights in ${source.title}`,
      payload,
      idempotencyKey: `clip.detect:${ctx.job.id}`,
    });
  });
  return { words: result.words.length };
};

const highlightSchema = z.object({
  clips: z.array(
    z.object({
      start: z.number(),
      end: z.number(),
      title: z.string(),
      hook: z.string(),
      score: z.number(),
      reason: z.string(),
    }),
  ),
});

export const clipDetect: JobHandler = async (ctx) => {
  const payload = transcribePayload.parse(ctx.job.payload);
  const { db, workspaceId } = ctx;
  const { source, media } = await loadSource(ctx, payload.sourceAssetId);
  const [transcript] = await db
    .select()
    .from(transcripts)
    .where(and(eq(transcripts.sourceAssetId, source.id), eq(transcripts.workspaceId, workspaceId)));
  if (!transcript) throw new PermanentError("Transcribe this video first.", "transcript_missing");

  const [project] = await db.select().from(projects).where(eq(projects.id, source.projectId));
  const [settings] = await db.select().from(projectSettings).where(eq(projectSettings.projectId, source.projectId));

  const result = await getLlm().generateJson(
    {
      system: `You pick self-contained moments from a video transcript that would work as short vertical clips. Prefer strong opening statements, surprising insights, emotional reactions, important questions, clear explanations and strong conclusions. A clip must make sense on its own. Clips must be ${payload.minSeconds} to ${payload.maxSeconds} seconds long. score is an estimated content opportunity from 0 to 100, not a prediction of views. Quote nothing that isn't in the transcript.`,
      user: JSON.stringify({
        niche: project?.niche,
        wanted: payload.clipCount,
        outputShape: "{ clips: [{ start (seconds), end (seconds), title, hook (one short line for on-screen text), score, reason (one sentence) }] }",
        segments: transcript.segments.map((s) => ({ start: s.start, end: s.end, text: s.text })),
      }),
      schema: highlightSchema,
    },
    { signal: ctx.signal, onUsage: ctx.usage },
  );

  const clips = normalizeHighlights(result.clips, transcript.segments, {
    minSeconds: payload.minSeconds,
    maxSeconds: payload.maxSeconds,
    sourceSeconds: media.durationSeconds ?? Number.POSITIVE_INFINITY,
  }).slice(0, payload.clipCount);
  if (clips.length === 0) {
    throw new PermanentError(`No moments fit ${payload.minSeconds}–${payload.maxSeconds} seconds. Widen the clip length and try again.`, "no_highlights");
  }

  const template = getTemplate(settings?.template);
  await db.transaction(async (tx) => {
    // Retries replace earlier candidates from this job instead of adding duplicates.
    const previous = await tx
      .select({ id: videoProjects.id, settings: videoProjects.generationSettings })
      .from(videoProjects)
      .where(and(eq(videoProjects.sourceAssetId, source.id), eq(videoProjects.workspaceId, workspaceId), eq(videoProjects.status, "candidate")));
    for (const row of previous) {
      if (row.settings.detectJobId === ctx.job.id) await tx.delete(videoProjects).where(eq(videoProjects.id, row.id));
    }
    for (const clip of clips) {
      const timeline = buildClipTimeline({
        sourceAssetId: media.id,
        start: clip.start,
        end: clip.end,
        words: transcript.words,
        hook: clip.hook,
        template,
        brand: {
          brandPrimary: settings?.brandPrimary ?? "#58D5C9",
          brandSecondary: settings?.brandSecondary ?? "#77A9FF",
          watermarkAssetId: settings?.logoAssetId,
        },
      });
      await tx.insert(videoProjects).values({
        workspaceId,
        projectId: source.projectId,
        mode: "clipper",
        status: "candidate",
        title: clip.title,
        hook: clip.hook,
        opportunityScore: clip.score,
        scoreReason: clip.reason,
        sourceAssetId: source.id,
        sourceStartSeconds: clip.start,
        sourceEndSeconds: clip.end,
        timeline,
        timelineVersion: 1,
        generationSettings: { detectJobId: ctx.job.id, template: template.id },
      });
    }
  });
  await ctx.log(`Created ${clips.length} candidate clips from ${source.title}.`);
  return { clips: clips.length };
};
