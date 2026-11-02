import { join } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { mediaAssets, type QaCheck, renderedVideos, videoProjects } from "../db/schema";
import { enqueue } from "../jobs/queue";
import { extractThumbnail, meanVolumeDb, normalizeLoudness, probeMedia } from "../media/ffmpeg";
import { renderTimeline } from "../render/render";
import { PermanentError } from "../services/errors";
import { getStorage } from "../services/registry";
import { collectAssetIds, TIMELINE_HEIGHT, TIMELINE_WIDTH, type TimelineSpec } from "../timeline/spec";
import type { JobHandler } from "./context";

const payloadSchema = z.object({ videoProjectId: z.string() });

export const renderVideo: JobHandler = async (ctx) => {
  const { videoProjectId } = payloadSchema.parse(ctx.job.payload);
  const { db, workspaceId } = ctx;
  const storage = getStorage();
  const [video] = await db
    .select()
    .from(videoProjects)
    .where(and(eq(videoProjects.id, videoProjectId), eq(videoProjects.workspaceId, workspaceId)));
  if (!video?.timeline) throw new PermanentError("This video has no timeline to render.", "timeline_missing");
  const spec = video.timeline;

  // Preflight: a missing asset is a permanent failure, not something a retry can fix.
  const ids = collectAssetIds(spec);
  const assets = ids.length
    ? await db.select().from(mediaAssets).where(and(eq(mediaAssets.workspaceId, workspaceId), inArray(mediaAssets.id, ids)))
    : [];
  const missing = ids.filter((id) => !assets.some((asset) => asset.id === id));
  if (missing.length > 0) throw new PermanentError(`${missing.length} media files on the timeline no longer exist.`, "assets_missing");
  for (const asset of assets) {
    if (!(await storage.exists(asset.storageKey))) throw new PermanentError(`Media file ${asset.filename ?? asset.id} is missing from storage.`, "assets_missing");
  }

  await db.update(videoProjects).set({ status: "rendering", lastError: null }).where(eq(videoProjects.id, videoProjectId));

  const rawPath = join(ctx.tmpDir, "raw.mp4");
  let lastReported = 0;
  const { renderMs } = await renderTimeline({
    spec,
    assetKeys: Object.fromEntries(assets.map((asset) => [asset.id, asset.storageKey])),
    storage,
    outputPath: rawPath,
    signal: ctx.signal,
    onProgress: (fraction) => {
      if (fraction - lastReported >= 0.05) {
        lastReported = fraction;
        void ctx.progress(fraction * 0.9);
      }
    },
  });

  const finalPath = join(ctx.tmpDir, "final.mp4");
  const normalized = await normalizeLoudness(rawPath, finalPath, ctx.signal);
  if (!normalized) await ctx.log("Audio was left as is because this cut is silent or couldn't be normalised.", "warn");
  const probe = await probeMedia(finalPath, ctx.signal);

  const baseKey = `${workspaceId}/renders/${videoProjectId}/v${video.timelineVersion}-${ctx.job.id}-${ctx.job.attempts}`;
  const { sizeBytes } = await storage.putFile(`${baseKey}.mp4`, finalPath, "video/mp4");
  const thumbPath = join(ctx.tmpDir, "thumb.jpg");
  await extractThumbnail(finalPath, thumbPath, Math.min(1, probe.durationSeconds / 2), ctx.signal);
  await storage.putFile(`${baseKey}.jpg`, thumbPath, "image/jpeg");

  await db.transaction(async (tx) => {
    const [asset] = await tx
      .insert(mediaAssets)
      .values({
        workspaceId,
        projectId: video.projectId,
        kind: "render",
        storageKey: `${baseKey}.mp4`,
        filename: `${video.title.replace(/[^\w -]+/g, "").slice(0, 60) || "video"}.mp4`,
        contentType: "video/mp4",
        sizeBytes,
        durationSeconds: probe.durationSeconds,
        width: probe.width,
        height: probe.height,
        metadata: { thumbnailKey: `${baseKey}.jpg` },
      })
      .returning();
    const [rendered] = await tx
      .insert(renderedVideos)
      .values({
        workspaceId,
        videoProjectId,
        mediaAssetId: asset.id,
        timelineVersion: video.timelineVersion,
        // Stored so each MP4 stays traceable to the exact spec that produced it.
        timelineSnapshot: spec,
        durationSeconds: probe.durationSeconds,
        width: probe.width,
        height: probe.height,
        sizeBytes,
        renderMs,
      })
      .returning();
    await enqueue(tx, {
      workspaceId,
      projectId: video.projectId,
      videoProjectId,
      agent: "qa",
      kind: "qa.check",
      label: `Check render: ${video.title}`,
      payload: { videoProjectId, renderedVideoId: rendered.id },
      idempotencyKey: `qa.check:${ctx.job.id}`,
    });
  });

  ctx.usage({ kind: "render", provider: "remotion", quantity: probe.durationSeconds, unit: "seconds", costMicroUsd: null });
  await ctx.log(`Rendered ${probe.durationSeconds.toFixed(1)} seconds in ${(renderMs / 1000).toFixed(0)} seconds.`);
  return { renderMs, sizeBytes };
};

/** Compares a rendered file with its spec. Pure, so each rule is testable. */
export function runQaChecks(
  spec: TimelineSpec,
  probe: { durationSeconds: number; width: number | null; height: number | null; hasVideo: boolean; hasAudio: boolean },
  meanVolume: number | null,
): QaCheck[] {
  const expectedSeconds = spec.durationInFrames / spec.fps;
  const captionsOverrun = spec.tracks.captions.filter((cue) => cue.from + cue.durationInFrames > spec.durationInFrames).length;
  const needsSpeech = spec.tracks.narration.length > 0;
  const silent = meanVolume === null || meanVolume < -60;
  return [
    { key: "video", label: "Video stream", passed: probe.hasVideo, detail: probe.hasVideo ? "Present" : "The file has no video stream.", blocking: true },
    {
      key: "dimensions",
      label: "1080 × 1920 output",
      passed: probe.width === TIMELINE_WIDTH && probe.height === TIMELINE_HEIGHT,
      detail: `${probe.width} × ${probe.height}`,
      blocking: true,
    },
    {
      key: "duration",
      label: "Duration matches timeline",
      passed: Math.abs(probe.durationSeconds - expectedSeconds) <= 0.5,
      detail: `File ${probe.durationSeconds.toFixed(2)}s, timeline ${expectedSeconds.toFixed(2)}s`,
      blocking: true,
    },
    { key: "audio", label: "Audio stream", passed: probe.hasAudio, detail: probe.hasAudio ? "Present" : "The file has no audio stream.", blocking: true },
    {
      key: "loudness",
      label: "Audible audio",
      passed: !silent,
      detail: meanVolume === null ? "Couldn't measure volume." : `Mean volume ${Number.isFinite(meanVolume) ? meanVolume.toFixed(1) : "-∞"} dB`,
      blocking: needsSpeech,
    },
    {
      key: "captions",
      label: "Captions present",
      passed: spec.tracks.captions.length > 0,
      detail: `${spec.tracks.captions.length} caption cues`,
      blocking: false,
    },
    {
      key: "caption_timing",
      label: "Captions fit the video",
      passed: captionsOverrun === 0,
      detail: captionsOverrun === 0 ? "All cues end before the video does." : `${captionsOverrun} cues run past the end.`,
      blocking: false,
    },
  ];
}

const qaPayload = z.object({ videoProjectId: z.string(), renderedVideoId: z.string() });

export const qaCheck: JobHandler = async (ctx) => {
  const { videoProjectId, renderedVideoId } = qaPayload.parse(ctx.job.payload);
  const { db, workspaceId } = ctx;
  const [row] = await db
    .select({ rendered: renderedVideos, asset: mediaAssets })
    .from(renderedVideos)
    .innerJoin(mediaAssets, eq(mediaAssets.id, renderedVideos.mediaAssetId))
    .where(and(eq(renderedVideos.id, renderedVideoId), eq(renderedVideos.workspaceId, workspaceId)));
  if (!row) throw new PermanentError("Rendered video not found", "not_found");

  const localPath = join(ctx.tmpDir, "check.mp4");
  await getStorage().downloadTo(row.asset.storageKey, localPath);
  const probe = await probeMedia(localPath, ctx.signal);
  const volume = await meanVolumeDb(localPath, ctx.signal);
  const checks = runQaChecks(row.rendered.timelineSnapshot, probe, volume);

  const failures = checks.filter((check) => !check.passed);
  const blocking = failures.filter((check) => check.blocking);
  const passed = blocking.length === 0;

  await db.transaction(async (tx) => {
    await tx.update(renderedVideos).set({ qaPassed: passed, qaReport: checks }).where(eq(renderedVideos.id, renderedVideoId));
    await tx
      .update(videoProjects)
      .set(
        passed
          ? { status: "pending_approval", lastError: null }
          : { status: "failed", lastError: `Quality check failed: ${blocking.map((check) => check.label).join(", ")}` },
      )
      .where(eq(videoProjects.id, videoProjectId));
  });

  await ctx.log(
    passed
      ? `Passed ${checks.length - failures.length} of ${checks.length} checks. Waiting for approval.`
      : `Failed: ${blocking.map((check) => `${check.label} (${check.detail})`).join("; ")}.`,
    passed ? (failures.length ? "warn" : "info") : "error",
  );
  return { passed, failures: failures.map((check) => check.key) };
};
