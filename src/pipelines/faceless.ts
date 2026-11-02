import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import {
  assetLicenses,
  contentIdeas,
  mediaAssets,
  projects,
  projectSettings,
  type ResearchFact,
  type ResearchSource,
  scripts,
  timelineTracks,
  videoProjects,
  videoScenes,
} from "../db/schema";
import { enqueue } from "../jobs/queue";
import { audioLevels, convertToMp3, probeMedia } from "../media/ffmpeg";
import { assertOk, PermanentError } from "../services/errors";
import { getLlm, getResearch, getStock, getStorage, getTts } from "../services/registry";
import { buildFacelessTimeline, estimateWordTimings, getTemplate, keywordsFromText, pickSpeakerVoice, type SceneInput } from "../timeline/build";
import { TIMELINE_FPS } from "../timeline/spec";
import type { JobContext, JobHandler } from "./context";

async function loadVideo(ctx: JobContext, videoProjectId: string) {
  const [video] = await ctx.db
    .select()
    .from(videoProjects)
    .where(and(eq(videoProjects.id, videoProjectId), eq(videoProjects.workspaceId, ctx.workspaceId)));
  if (!video) throw new PermanentError("Video not found", "not_found");
  const [project] = await ctx.db.select().from(projects).where(eq(projects.id, video.projectId));
  const [settings] = await ctx.db.select().from(projectSettings).where(eq(projectSettings.projectId, video.projectId));
  return { video, project, settings };
}

const videoPayload = z.object({
  videoProjectId: z.string(),
  sceneIds: z.array(z.string()).optional(),
  /** False when regenerating a scene, so the person can review the edit before rendering. */
  render: z.boolean().default(true),
});

const factsSchema = z.object({
  angle: z.string(),
  facts: z.array(z.object({ claim: z.string(), sourceIds: z.array(z.string()).default([]) })),
});

export const facelessResearch: JobHandler = async (ctx) => {
  const { videoProjectId } = videoPayload.parse(ctx.job.payload);
  const { video, project } = await loadVideo(ctx, videoProjectId);
  if (!video.contentIdeaId) throw new PermanentError("This video has no topic to research.", "topic_missing");
  const [idea] = await ctx.db.select().from(contentIdeas).where(eq(contentIdeas.id, video.contentIdeaId));

  const documents = await getResearch().search(idea.topic, { signal: ctx.signal, language: project.language, limit: 4 });
  const sources: ResearchSource[] = documents.map((doc, index) => ({ id: `s${index + 1}`, ...doc }));
  await ctx.log(`Read ${sources.length} sources on "${idea.topic}".`);
  await ctx.progress(0.4);

  const result = await getLlm().generateJson(
    {
      system:
        "You extract facts for a short educational video. Use only claims stated in the numbered sources, and cite the ids of the sources that state each one. If you include something useful the sources don't state, give it an empty sourceIds list. Paraphrase. Never copy sentences.",
      user: JSON.stringify({
        topic: idea.topic,
        niche: project.niche,
        audience: project.targetAudience,
        outputShape: "{ angle (one sentence), facts: [{ claim, sourceIds }] }",
        sources: sources.map((s) => ({ id: s.id, title: s.title, text: s.excerpt })),
      }),
      schema: factsSchema,
    },
    { signal: ctx.signal, onUsage: ctx.usage },
  );

  // Only a citation of a real source counts as support, whatever the model claims.
  const validIds = new Set(sources.map((s) => s.id));
  const facts: ResearchFact[] = result.facts.map((fact) => {
    const sourceIds = fact.sourceIds.filter((id) => validIds.has(id));
    return { claim: fact.claim, sourceIds, status: sourceIds.length > 0 ? "supported" : "uncertain" };
  });
  const supported = facts.filter((f) => f.status === "supported").length;
  await ctx.log(`Kept ${supported} source-backed facts and flagged ${facts.length - supported} as uncertain.`, supported === 0 ? "warn" : "info");
  if (supported === 0) throw new PermanentError("The sources didn't support any usable facts. Try a more specific topic.", "no_supported_facts");

  await ctx.db.transaction(async (tx) => {
    await tx.update(contentIdeas).set({ sources, facts, angle: result.angle, researchedAt: new Date() }).where(eq(contentIdeas.id, idea.id));
    await enqueue(tx, {
      workspaceId: ctx.workspaceId,
      projectId: video.projectId,
      videoProjectId,
      agent: "script",
      kind: "faceless.script",
      label: `Write script: ${idea.topic}`,
      payload: { videoProjectId },
      idempotencyKey: `faceless.script:${ctx.job.id}`,
    });
  });
  return { sources: sources.length, supported };
};

const scriptSchema = z.object({
  title: z.string(),
  hook: z.string(),
  callToAction: z.string(),
  scenes: z.array(z.object({ narration: z.string(), visualQuery: z.string() })).min(1),
});

export const facelessScript: JobHandler = async (ctx) => {
  const { videoProjectId } = videoPayload.parse(ctx.job.payload);
  const { video, project, settings } = await loadVideo(ctx, videoProjectId);
  const [idea] = await ctx.db.select().from(contentIdeas).where(eq(contentIdeas.id, video.contentIdeaId!));
  const seconds = video.targetDurationSeconds ?? settings?.preferredDurationSeconds ?? 30;
  const tone = video.tone ?? settings?.tone ?? "educational";

  const result = await getLlm().generateJson(
    {
      system: `You write original narration for faceless short-form videos, in your own words. Tone: ${tone}. Language: ${project.language}. Structure: attention-grabbing hook, topic introduction, main explanation, supporting details, strong ending or call to action. Aim for about ${Math.round(seconds * 2.4)} spoken words in total. Use only the facts provided and state nothing else as fact. Write one scene per visual idea, 8 to 25 words each. visualQuery is 2 to 4 concrete words for a stock footage search, naming things a camera could film.`,
      user: JSON.stringify({
        topic: idea.topic,
        angle: idea.angle,
        audience: project.targetAudience,
        outputShape: "{ title, hook (under 9 words, for on-screen text), callToAction, scenes: [{ narration, visualQuery }] }",
        facts: idea.facts.filter((f) => f.status === "supported").map((f) => f.claim),
      }),
      schema: scriptSchema,
      temperature: 0.7,
    },
    { signal: ctx.signal, onUsage: ctx.usage },
  );

  const body = result.scenes.map((s) => s.narration).join(" ");
  await ctx.db.transaction(async (tx) => {
    const values = {
      workspaceId: ctx.workspaceId,
      videoProjectId,
      origin: "ai",
      title: result.title,
      hook: result.hook,
      callToAction: result.callToAction,
      body,
      tone,
      targetDurationSeconds: seconds,
    };
    await tx.insert(scripts).values(values).onConflictDoUpdate({ target: scripts.videoProjectId, set: values });
    await tx.delete(videoScenes).where(eq(videoScenes.videoProjectId, videoProjectId));
    await tx.insert(videoScenes).values(
      result.scenes.map((scene, position) => ({
        workspaceId: ctx.workspaceId,
        videoProjectId,
        position,
        narration: scene.narration,
        visualQuery: scene.visualQuery,
      })),
    );
    await tx.update(videoProjects).set({ title: result.title, hook: result.hook }).where(eq(videoProjects.id, videoProjectId));
    await enqueue(tx, {
      workspaceId: ctx.workspaceId,
      projectId: video.projectId,
      videoProjectId,
      agent: "voice",
      kind: "faceless.voice",
      label: `Record narration: ${result.title}`,
      payload: { videoProjectId },
      idempotencyKey: `faceless.voice:${ctx.job.id}`,
    });
  });
  await ctx.log(`Wrote ${result.scenes.length} scenes, about ${body.split(/\s+/).length} words.`);
  return { scenes: result.scenes.length };
};

export const facelessVoice: JobHandler = async (ctx) => {
  const payload = videoPayload.parse(ctx.job.payload);
  const { video, settings, project } = await loadVideo(ctx, payload.videoProjectId);
  const tts = getTts();
  const storage = getStorage();

  const scenes = await ctx.db
    .select()
    .from(videoScenes)
    .where(and(eq(videoScenes.videoProjectId, video.id), eq(videoScenes.workspaceId, ctx.workspaceId)))
    .orderBy(asc(videoScenes.position));
  if (scenes.length === 0) throw new PermanentError("This video has no scenes to narrate.", "scenes_missing");

  // On a retry, scenes already voiced by this job are kept, so nothing is billed twice.
  const targets = payload.sceneIds ? scenes.filter((s) => payload.sceneIds!.includes(s.id)) : scenes.filter((s) => !s.narrationAssetId);

  // Hosts are numbered across the whole script, so re-recording one scene keeps that host's voice.
  const speakers = [...new Set(scenes.map((scene) => scene.speaker).filter(Boolean))];
  const voices = speakers.length > 0 ? await tts.listVoices() : [];

  let done = 0;
  for (const scene of targets) {
    const voiceId = scene.speaker ? pickSpeakerVoice(voices, speakers.indexOf(scene.speaker), settings?.voiceId) : settings?.voiceId;
    const spoken = await tts.synthesize(
      { text: scene.narration, voiceId, speed: settings?.voiceSpeed, language: project.language, outputPathWithoutExt: join(ctx.tmpDir, `scene-${scene.id}`) },
      { signal: ctx.signal, onUsage: ctx.usage },
    );
    let audioPath = spoken.path;
    if (spoken.format !== "mp3") {
      audioPath = join(ctx.tmpDir, `scene-${scene.id}.mp3`);
      await convertToMp3(spoken.path, audioPath, ctx.signal);
    }
    const probe = await probeMedia(audioPath, ctx.signal);
    const key = `${ctx.workspaceId}/narration/${scene.id}-${ctx.job.id}-${ctx.job.attempts}.mp3`;
    const { sizeBytes } = await storage.putFile(key, audioPath, "audio/mpeg");
    const [asset] = await ctx.db
      .insert(mediaAssets)
      .values({
        workspaceId: ctx.workspaceId,
        projectId: video.projectId,
        kind: "narration",
        storageKey: key,
        contentType: "audio/mpeg",
        sizeBytes,
        durationSeconds: probe.durationSeconds,
        metadata: { provider: tts.name, voiceId: voiceId ?? null, synthetic: tts.isSynthetic },
      })
      .returning();
    await ctx.db
      .update(videoScenes)
      .set({
        narrationAssetId: asset.id,
        durationSeconds: probe.durationSeconds,
        wordTimings: spoken.words ?? estimateWordTimings(scene.narration, probe.durationSeconds),
        timingSource: spoken.words ? "provider" : "estimated",
      })
      .where(eq(videoScenes.id, scene.id));
    done += 1;
    await ctx.progress(done / targets.length);
  }
  await ctx.log(`Recorded ${done} scenes with ${tts.name}.`);

  await enqueue(ctx.db, {
    workspaceId: ctx.workspaceId,
    projectId: video.projectId,
    videoProjectId: video.id,
    agent: "visual",
    kind: "faceless.visuals",
    label: `Choose B-roll: ${video.title}`,
    payload: { videoProjectId: video.id, render: payload.render },
    idempotencyKey: `faceless.visuals:${ctx.job.id}`,
  });
  return { recorded: done, provider: tts.name };
};

const MAX_STOCK_BYTES = 300 * 1024 * 1024;

async function downloadClip(url: string, path: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  await assertOk(response, "Stock video download");
  if (Number(response.headers.get("content-length") ?? 0) > MAX_STOCK_BYTES) throw new PermanentError("Stock clip is too large.", "stock_too_large");
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(path));
}

export const facelessVisuals: JobHandler = async (ctx) => {
  const payload = videoPayload.parse(ctx.job.payload);
  const { video } = await loadVideo(ctx, payload.videoProjectId);
  const stock = getStock();
  const storage = getStorage();
  const scenes = await ctx.db
    .select()
    .from(videoScenes)
    .where(and(eq(videoScenes.videoProjectId, video.id), eq(videoScenes.workspaceId, ctx.workspaceId)))
    .orderBy(asc(videoScenes.position));

  const targets = payload.sceneIds ? scenes.filter((s) => payload.sceneIds!.includes(s.id)) : scenes.filter((s) => !s.visualAssetId);

  if (!stock) {
    await ctx.log("No stock provider is configured, so these scenes use typographic cards. No footage was added.", "warn");
  } else {
    // Footage already in this video is excluded, so no clip repeats across scenes.
    const usedIds = new Set(
      (
        await ctx.db
          .select({ metadata: mediaAssets.metadata })
          .from(videoScenes)
          .innerJoin(mediaAssets, eq(mediaAssets.id, videoScenes.visualAssetId))
          .where(and(eq(videoScenes.videoProjectId, video.id), isNotNull(videoScenes.visualAssetId)))
      ).map((row) => String(row.metadata.externalId)),
    );
    let done = 0;
    for (const scene of targets) {
      const query = scene.visualQuery ?? keywordsFromText(scene.narration);
      const results = query ? await stock.search(query, { signal: ctx.signal, onUsage: ctx.usage }) : [];
      const clip = results.find((candidate) => !usedIds.has(candidate.externalId));
      if (!clip) {
        await ctx.log(`No unused stock clip for "${query}". Scene ${scene.position + 1} uses a typographic card.`, "warn");
        await ctx.db.update(videoScenes).set({ visualAssetId: null }).where(eq(videoScenes.id, scene.id));
      } else {
        usedIds.add(clip.externalId);
        const localPath = join(ctx.tmpDir, `broll-${clip.externalId}.mp4`);
        await downloadClip(clip.downloadUrl, localPath, ctx.signal);
        const probe = await probeMedia(localPath, ctx.signal);
        const key = `${ctx.workspaceId}/broll/${clip.provider}-${clip.externalId}-${scene.id}-${ctx.job.id}.mp4`;
        const { sizeBytes } = await storage.putFile(key, localPath, "video/mp4");
        await ctx.db.transaction(async (tx) => {
          const [asset] = await tx
            .insert(mediaAssets)
            .values({
              workspaceId: ctx.workspaceId,
              projectId: video.projectId,
              kind: "broll_video",
              storageKey: key,
              contentType: "video/mp4",
              sizeBytes,
              durationSeconds: probe.durationSeconds,
              width: probe.width,
              height: probe.height,
              metadata: { externalId: clip.externalId, provider: clip.provider, query },
            })
            .returning();
          await tx.insert(assetLicenses).values({
            workspaceId: ctx.workspaceId,
            mediaAssetId: asset.id,
            provider: clip.provider,
            license: clip.license,
            sourceUrl: clip.pageUrl,
            attribution: clip.attribution,
          });
          await tx.update(videoScenes).set({ visualAssetId: asset.id, visualQuery: query }).where(eq(videoScenes.id, scene.id));
        });
      }
      done += 1;
      await ctx.progress(done / targets.length);
    }
    await ctx.log(`Chose footage for ${done} scenes from ${stock.name}.`);
  }

  await enqueue(ctx.db, {
    workspaceId: ctx.workspaceId,
    projectId: video.projectId,
    videoProjectId: video.id,
    agent: "editing",
    kind: "edit.assemble",
    label: `Assemble timeline: ${video.title}`,
    payload: { videoProjectId: video.id, render: payload.render },
    idempotencyKey: `edit.assemble:${ctx.job.id}`,
  });
  return { provider: stock?.name ?? null };
};

export const editAssemble: JobHandler = async (ctx) => {
  const payload = videoPayload.parse(ctx.job.payload);
  const { video, settings } = await loadVideo(ctx, payload.videoProjectId);
  const scenes = await ctx.db
    .select()
    .from(videoScenes)
    .where(and(eq(videoScenes.videoProjectId, video.id), eq(videoScenes.workspaceId, ctx.workspaceId)))
    .orderBy(asc(videoScenes.position));

  const missing = scenes.filter((scene) => !scene.narrationAssetId || !scene.durationSeconds);
  if (missing.length > 0) throw new PermanentError(`${missing.length} scenes have no narration yet.`, "narration_missing");

  // A script that names its hosts is a podcast, unless the project asks for split-screen.
  const template = getTemplate(scenes.some((scene) => scene.speaker) && settings?.template !== "runner" ? "podcast" : settings?.template);
  const narrationIds = template.id === "podcast" ? scenes.map((s) => s.narrationAssetId!) : [];
  const assetIds = scenes.map((s) => s.visualAssetId).filter((id): id is string => Boolean(id));
  const musicId = settings?.musicAssetId ?? null;
  const assets = await ctx.db
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.workspaceId, ctx.workspaceId), inArray(mediaAssets.id, [...assetIds, ...narrationIds, ...(musicId ? [musicId] : [])])));
  const byId = new Map(assets.map((asset) => [asset.id, asset]));

  const levelsByScene = new Map<string, number[]>();
  for (const scene of template.id === "podcast" ? scenes : []) {
    const asset = byId.get(scene.narrationAssetId!);
    if (!asset) continue;
    const localPath = join(ctx.tmpDir, `levels-${scene.id}.mp3`);
    await getStorage().downloadTo(asset.storageKey, localPath);
    levelsByScene.set(scene.id, await audioLevels(localPath, TIMELINE_FPS, ctx.signal));
  }

  const sceneInputs: SceneInput[] = scenes.map((scene) => {
    const asset = scene.visualAssetId ? byId.get(scene.visualAssetId) : undefined;
    let visual: SceneInput["visual"] = { type: "card" };
    if (asset?.kind === "broll_video" || asset?.kind === "source_video") visual = { type: "video", assetId: asset.id, durationSeconds: asset.durationSeconds };
    if (asset?.kind === "broll_image") visual = { type: "image", assetId: asset.id };
    return {
      id: scene.id,
      narration: scene.narration,
      narrationAssetId: scene.narrationAssetId!,
      durationSeconds: scene.durationSeconds!,
      words: scene.wordTimings ?? [],
      visual,
      speaker: scene.speaker,
      callout: scene.callout,
      levels: levelsByScene.get(scene.id),
    };
  });

  const music = musicId ? byId.get(musicId) : undefined;
  const spec = buildFacelessTimeline({
    scenes: sceneInputs,
    hook: video.hook,
    title: video.title,
    template,
    brand: {
      brandPrimary: settings?.brandPrimary ?? "#58D5C9",
      brandSecondary: settings?.brandSecondary ?? "#77A9FF",
      watermarkAssetId: settings?.logoAssetId,
    },
    music: music ? { assetId: music.id, durationSeconds: music.durationSeconds } : null,
  });

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(videoProjects)
      .set({ timeline: spec, timelineVersion: video.timelineVersion + 1, status: payload.render ? "in_production" : "ready_to_render", lastError: null })
      .where(eq(videoProjects.id, video.id));
    for (const [position, kind] of ["visual", "narration", "captions", "text", "music"].entries()) {
      await tx
        .insert(timelineTracks)
        .values({ workspaceId: ctx.workspaceId, videoProjectId: video.id, kind, position })
        .onConflictDoNothing();
    }
    if (payload.render) {
      await enqueue(tx, {
        workspaceId: ctx.workspaceId,
        projectId: video.projectId,
        videoProjectId: video.id,
        agent: "editing",
        kind: "render.video",
        label: `Render: ${video.title}`,
        payload: { videoProjectId: video.id },
        idempotencyKey: `render.video:${ctx.job.id}`,
        maxAttempts: 2,
      });
    }
  });
  await ctx.log(`Assembled ${scenes.length} scenes, ${(spec.durationInFrames / spec.fps).toFixed(1)} seconds.`);
  return { durationSeconds: spec.durationInFrames / spec.fps };
};
