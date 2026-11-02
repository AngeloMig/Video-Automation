import { execFile } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { config } from "dotenv";

config({ path: ".env.local" });

/**
 * Runs both content modes through the real queue, worker, Remotion and FFmpeg against real
 * Postgres. Provider calls use tests/fixtures/fake-providers.ts unless the scenario says otherwise.
 * Needs `pnpm db:local` running. Finished MP4s are copied to .data/e2e-output for inspection.
 */
const exec = promisify(execFile);
const workDir = mkdtempSync(join(tmpdir(), "video-e2e-"));
const outputDir = resolve(".data/e2e-output");
mkdirSync(outputDir, { recursive: true });

// Provider env must be set before any scenario reads it. These vars never point at real services.
process.env.LOCAL_STORAGE_DIR = join(workDir, "storage");
for (const name of ["OPENAI_API_KEY", "ELEVENLABS_API_KEY", "PEXELS_API_KEY", "PIXABAY_API_KEY", "YOUTUBE_API_KEY", "TTS_PROVIDER", "S3_BUCKET"]) delete process.env[name];

let failures = 0;
function check(label: string, passed: boolean, detail = "") {
  console.log(`${passed ? "  ok " : "FAIL "} ${label}${detail ? `  (${detail})` : ""}`);
  if (!passed) failures += 1;
}

async function main() {
  const { eq, sql, and } = await import("drizzle-orm");
  const { finishProcess, serviceDb, withUser } = await import("../src/db/client");
  const schema = await import("../src/db/schema");
  const domain = await import("../src/server/domain");
  const { workLoop } = await import("../src/worker/runner");
  const { probeMedia } = await import("../src/media/ffmpeg");
  const { registerUploadedFile } = await import("../src/server/uploads");
  const { startFakeProviders } = await import("../tests/fixtures/fake-providers");
  const { createRequire } = await import("node:module");
  const ffmpeg = createRequire(import.meta.url)("ffmpeg-static") as string;

  const db = serviceDb();
  const email = `e2e-${Date.now()}@test.local`;
  const [{ id: userId }] = (await db.execute(sql`insert into auth.users (email) values (${email}) returning id`)) as unknown as { id: string }[];
  const [member] = await db.select().from(schema.workspaceMembers).where(eq(schema.workspaceMembers.userId, userId));
  const ctx = { userId, workspaceId: member.workspaceId };
  await db.update(schema.subscriptions).set({ plan: "pro" }).where(eq(schema.subscriptions.workspaceId, ctx.workspaceId));

  const drain = () => workLoop({ workerId: `e2e-${process.pid}`, shouldStop: () => false, untilIdle: true });
  const jobsOf = (videoId: string) => db.select().from(schema.productionJobs).where(eq(schema.productionJobs.videoProjectId, videoId));
  const videoOf = async (videoId: string) => (await db.select().from(schema.videoProjects).where(eq(schema.videoProjects.id, videoId)))[0];
  const renderOf = async (videoId: string) => {
    const [row] = await db
      .select({ rendered: schema.renderedVideos, asset: schema.mediaAssets })
      .from(schema.renderedVideos)
      .innerJoin(schema.mediaAssets, eq(schema.mediaAssets.id, schema.renderedVideos.mediaAssetId))
      .where(eq(schema.renderedVideos.videoProjectId, videoId));
    return row;
  };
  const storagePath = (key: string) => join(process.env.LOCAL_STORAGE_DIR!, key);

  const assertProduced = async (videoId: string, name: string) => {
    const video = await videoOf(videoId);
    check(`${name}: reached pending approval`, video.status === "pending_approval", `${video.status} ${video.lastError ?? ""}`);
    const render = await renderOf(videoId);
    if (!render) return check(`${name}: has a render`, false);
    const probe = await probeMedia(storagePath(render.asset.storageKey));
    check(`${name}: MP4 is 1080x1920`, probe.width === 1080 && probe.height === 1920, `${probe.width}x${probe.height}`);
    check(`${name}: MP4 has audio`, probe.hasAudio);
    check(`${name}: h264 video`, probe.videoCodec === "h264", String(probe.videoCodec));
    check(`${name}: QA passed`, render.rendered.qaPassed === true, JSON.stringify(render.rendered.qaReport?.filter((c) => !c.passed)));
    const expected = video.timeline!.durationInFrames / 30;
    check(`${name}: duration matches timeline`, Math.abs(probe.durationSeconds - expected) < 0.5, `${probe.durationSeconds.toFixed(2)}s vs ${expected.toFixed(2)}s`);
    copyFileSync(storagePath(render.asset.storageKey), join(outputDir, `${name}.mp4`));
  };

  // Fixtures: real speech from macOS `say`, and synthetic test-pattern video.
  const aiff = join(workDir, "speech.aiff");
  const speechMp3 = join(workDir, "speech.mp3");
  await exec("say", ["-o", aiff, "The opening claim is simple and worth hearing. Here is why it matters to you today, and what to do next."]);
  await exec(ffmpeg, ["-y", "-i", aiff, speechMp3]);
  const stockMp4 = join(workDir, "stock.mp4");
  await exec(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30:duration=3", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", stockMp4]);
  const sourceMp4 = join(workDir, "source.mp4");
  await exec(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=30:duration=12", "-stream_loop", "-1", "-i", speechMp3, "-t", "12", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", sourceMp4]);
  const silentMp4 = join(workDir, "silent.mp4");
  await exec(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=30:duration=6", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", silentMp4]);

  const project = await withUser(userId, (tx) =>
    domain.createProject(tx, ctx, { name: "E2E", niche: "space", mode: "faceless", keywords: ["space"], excludedKeywords: ["gambling"] }),
  );

  console.log("\nScenario 1: faceless with no API keys (own script, Kokoro voice, typographic cards)");
  const manual = await withUser(userId, (tx) =>
    domain.createFacelessVideo(tx, ctx, {
      projectId: project.id,
      script: "Mars has the tallest volcano in the solar system. It is called Olympus Mons. It stands about three times higher than Mount Everest.",
      title: "The tallest volcano",
    }),
  );
  await drain();
  await assertProduced(manual.id, "faceless-no-keys");
  const manualScenes = await db.select().from(schema.videoScenes).where(eq(schema.videoScenes.videoProjectId, manual.id));
  check("no keys: captions are marked estimated", manualScenes.every((scene) => scene.timingSource === "estimated"));
  check("no keys: no footage was invented", manualScenes.every((scene) => scene.visualAssetId === null));

  console.log("\nScenario 2: missing key fails clearly, without retries, and can recover");
  const blocked = await withUser(userId, (tx) => domain.createFacelessVideo(tx, ctx, { projectId: project.id, topic: "Olympus Mons" }));
  await drain();
  const blockedJobs = await jobsOf(blocked.id);
  check("missing key: job failed", blockedJobs[0].status === "failed", blockedJobs[0].errorCode ?? "");
  check("missing key: not retried", blockedJobs[0].attempts === 1, `attempts ${blockedJobs[0].attempts}`);
  check("missing key: error names the key", (blockedJobs[0].errorMessage ?? "").includes("OPENAI_API_KEY"));
  check("missing key: video marked failed", (await videoOf(blocked.id)).status === "failed");

  const fake = await startFakeProviders({
    speechMp3Path: speechMp3,
    stockMp4Path: stockMp4,
    transcriptWords: "The opening claim is simple and worth hearing. Here is why it matters to you today, and what to do next."
      .split(" ")
      .map((word, index) => ({ word, start: 0.3 + index * 0.5, end: 0.3 + index * 0.5 + 0.42 })),
    transcriptSegments: [
      { start: 0.3, end: 6.3, text: "The opening claim is simple and worth hearing. Here is" },
      { start: 6.3, end: 12, text: "why it matters to you today, and what to do next." },
    ],
  });
  process.env.OPENAI_API_KEY = "fake";
  process.env.OPENAI_BASE_URL = `${fake.baseUrl}/v1`;
  process.env.PEXELS_API_KEY = "fake";
  process.env.PEXELS_BASE_URL = fake.baseUrl;
  process.env.YOUTUBE_API_KEY = "fake";
  process.env.YOUTUBE_BASE_URL = `${fake.baseUrl}/yt`;
  process.env.TTS_PROVIDER = "openai";

  await withUser(userId, (tx) => domain.retryJob(tx, ctx, blockedJobs[0].id));
  await drain();
  check("recovery: retried job succeeded after the key was added", (await jobsOf(blocked.id)).every((job) => job.status === "succeeded"), (await jobsOf(blocked.id)).map((j) => `${j.kind}:${j.status}`).join(" "));

  console.log("\nScenario 3: faceless with providers (real Wikipedia, stand-in AI, voice and stock)");
  await assertProduced(blocked.id, "faceless-ai");
  const [idea] = await db.select().from(schema.contentIdeas).where(eq(schema.contentIdeas.id, (await videoOf(blocked.id)).contentIdeaId!));
  check("research: stored real Wikipedia sources", idea.sources.length > 0 && idea.sources.every((s) => s.url.includes("wikipedia.org")), `${idea.sources.length} sources`);
  const statuses = idea.facts.map((f) => f.status);
  check("research: a cited fact is supported", statuses[0] === "supported");
  check("research: an uncited fact is uncertain", statuses[1] === "uncertain");
  check("research: a made-up citation doesn't count", statuses[2] === "uncertain");
  const aiScenes = await db.select().from(schema.videoScenes).where(eq(schema.videoScenes.videoProjectId, blocked.id));
  check("visuals: every scene has footage", aiScenes.every((scene) => scene.visualAssetId));
  check("visuals: no clip repeats", new Set(aiScenes.map((scene) => scene.visualAssetId)).size === aiScenes.length);
  const licenses = await db.select().from(schema.assetLicenses).where(eq(schema.assetLicenses.workspaceId, ctx.workspaceId));
  check("visuals: license stored for each clip", licenses.length >= aiScenes.length && licenses.every((l) => l.license === "Pexels License"));
  const costed = (await jobsOf(blocked.id)).reduce((sum, job) => sum + job.costMicroUsd, 0);
  check("usage: cost recorded", costed > 0, `${costed} micro-USD estimated`);

  console.log("\nScenario 4: regenerate one scene without restarting the video");
  const before = await videoOf(blocked.id);
  const target = aiScenes.sort((a, b) => a.position - b.position)[1];
  const untouched = aiScenes[0];
  const jobCountBefore = (await jobsOf(blocked.id)).length;
  await withUser(userId, (tx) => domain.regenerateScene(tx, ctx, { sceneId: target.id, narration: "A rewritten second scene for viewers." }));
  await drain();
  const [rewritten] = await db.select().from(schema.videoScenes).where(eq(schema.videoScenes.id, target.id));
  const [kept] = await db.select().from(schema.videoScenes).where(eq(schema.videoScenes.id, untouched.id));
  const after = await videoOf(blocked.id);
  check("regenerate: scene got new narration audio", rewritten.narrationAssetId !== target.narrationAssetId);
  check("regenerate: other scenes untouched", kept.narrationAssetId === untouched.narrationAssetId && kept.visualAssetId === untouched.visualAssetId);
  check("regenerate: timeline version advanced", after.timelineVersion > before.timelineVersion);
  check("regenerate: waits for review instead of rendering", after.status === "ready_to_render", after.status);
  check("regenerate: only downstream jobs ran", (await jobsOf(blocked.id)).length - jobCountBefore === 3);

  console.log("\nScenario 5: AI clipper on an uploaded video");
  const key = `${ctx.workspaceId}/uploads/source.mp4`;
  mkdirSync(join(process.env.LOCAL_STORAGE_DIR!, ctx.workspaceId, "uploads"), { recursive: true });
  copyFileSync(sourceMp4, storagePath(key));
  const media = await registerUploadedFile(ctx, { projectId: project.id, kind: "source_video", storageKey: key, filename: "source.mp4", contentType: "video/mp4" });
  check("upload: duration read from the real file", Math.abs((media.durationSeconds ?? 0) - 12) < 1, String(media.durationSeconds));

  let rightsRejected = false;
  try {
    await withUser(userId, (tx) =>
      domain.registerSource(tx, ctx, { projectId: project.id, mediaAssetId: media.id, title: "Talk", rightsBasis: "i_created_it", rightsConfirmed: false as true }),
    );
  } catch {
    rightsRejected = true;
  }
  check("rights: refused without confirmation", rightsRejected);

  const source = await withUser(userId, (tx) =>
    domain.registerSource(tx, ctx, { projectId: project.id, mediaAssetId: media.id, title: "Talk", rightsBasis: "i_created_it", rightsConfirmed: true }),
  );
  await withUser(userId, (tx) => domain.startClipAnalysis(tx, ctx, { sourceAssetId: source.id, minSeconds: 5, maxSeconds: 10, clipCount: 3 }));
  await drain();
  const candidates = await db.select().from(schema.videoProjects).where(and(eq(schema.videoProjects.sourceAssetId, source.id), eq(schema.videoProjects.status, "candidate")));
  check("clipper: overlapping candidate dropped", candidates.length === 2, `${candidates.length} candidates`);
  check("clipper: candidates have score, hook and range", candidates.every((c) => c.opportunityScore !== null && c.hook && c.sourceEndSeconds! > c.sourceStartSeconds!));
  const best = candidates.sort((a, b) => b.opportunityScore! - a.opportunityScore!)[0];
  check("clipper: captions built from words", best.timeline!.tracks.captions.length > 0, `${best.timeline!.tracks.captions.length} cues`);
  await withUser(userId, (tx) => domain.requestRender(tx, ctx, best.id));
  await drain();
  await assertProduced(best.id, "clipper-ai");

  console.log("\nScenario 6: manual clip by timecode");
  const manualClip = await withUser(userId, (tx) => domain.createManualClip(tx, ctx, { sourceAssetId: source.id, title: "By hand", startSeconds: 2, endSeconds: 7, focusX: 0.3 }));
  await withUser(userId, (tx) => domain.requestRender(tx, ctx, manualClip.id));
  await drain();
  await assertProduced(manualClip.id, "clipper-manual");

  console.log("\nScenario 6b: clip from a source with no audio (regression: loudnorm crashed on silence)");
  const silentKey = `${ctx.workspaceId}/uploads/silent.mp4`;
  copyFileSync(silentMp4, storagePath(silentKey));
  const silentMedia = await registerUploadedFile(ctx, { projectId: project.id, kind: "source_video", storageKey: silentKey, filename: "silent.mp4", contentType: "video/mp4" });
  const silentSource = await withUser(userId, (tx) =>
    domain.registerSource(tx, ctx, { projectId: project.id, mediaAssetId: silentMedia.id, title: "Silent", rightsBasis: "i_created_it", rightsConfirmed: true }),
  );
  const silentClip = await withUser(userId, (tx) => domain.createManualClip(tx, ctx, { sourceAssetId: silentSource.id, title: "Silent cut", startSeconds: 1, endSeconds: 4 }));
  await withUser(userId, (tx) => domain.requestRender(tx, ctx, silentClip.id));
  await drain();
  await assertProduced(silentClip.id, "clipper-silent");
  const silentRender = await renderOf(silentClip.id);
  check("silent clip: QA flags the silence without blocking", silentRender?.rendered.qaReport?.find((c) => c.key === "loudness")?.passed === false);

  console.log("\nScenario 7: approval, editing and export rules");
  let approvedEarly = false;
  try {
    await withUser(userId, (tx) => domain.setVideoApproval(tx, ctx, after.id, "approved"));
    approvedEarly = true;
  } catch {}
  check("approval: an unrendered edit can't be approved", !approvedEarly);
  await withUser(userId, (tx) => domain.setVideoApproval(tx, ctx, manualClip.id, "approved"));
  check("approval: approved", (await videoOf(manualClip.id)).status === "approved");
  const spec = structuredClone((await videoOf(manualClip.id)).timeline!);
  spec.style.caption.fontSize = 80;
  const version = await withUser(userId, (tx) => domain.saveTimeline(tx, ctx, manualClip.id, spec, "bigger captions"));
  const edited = await videoOf(manualClip.id);
  check("edit: persisted with a new version", edited.timeline!.style.caption.fontSize === 80 && edited.timelineVersion === version);
  check("edit: voids earlier approval", edited.status === "ready_to_render" && edited.approvedAt === null);
  await withUser(userId, (tx) => domain.restoreTimelineVersion(tx, ctx, manualClip.id, version));
  check("edit: version restore works", (await videoOf(manualClip.id)).timelineVersion === version + 1);

  console.log("\nScenario 8: discovery through the official API");
  await withUser(userId, (tx) => domain.startDiscovery(tx, ctx, { projectId: project.id, query: "mars" }));
  await drain();
  const found = await db.select().from(schema.discoveredVideos).where(eq(schema.discoveredVideos.projectId, project.id));
  check("discovery: excluded keyword filtered", found.length === 2 && !found.some((v) => v.title.includes("gambling")), `${found.length} kept`);
  check("discovery: score is 0 to 100 with reasons", found.every((v) => v.opportunityScore! >= 0 && v.opportunityScore! <= 100 && v.scoreBreakdown!.factors.length === 8));
  check("discovery: hidden counts stay null, not zero", found.find((v) => v.youtubeId === "bbbbbbbbbbb")?.likeCount === null);
  check("discovery: rights marked metadata only", found.every((v) => v.rightsStatus === "metadata_only"));
  await withUser(userId, (tx) => domain.startDiscovery(tx, ctx, { projectId: project.id, query: "mars" }));
  await drain();
  const again = await db.select().from(schema.discoveredVideos).where(eq(schema.discoveredVideos.projectId, project.id));
  check("discovery: repeat search doesn't duplicate", again.length === found.length);

  console.log("\nScenario 9: transient failure retries with backoff");
  fake.failNext("/v1/chat/completions", 503);
  await withUser(userId, (tx) => domain.startDiscovery(tx, ctx, { projectId: project.id, query: "retry" }));
  await drain();
  const [retrying] = await db.select().from(schema.productionJobs).where(sql`${schema.productionJobs.label} like '%retry%'`);
  check("retry: back in queue, scheduled for later", retrying.status === "queued" && retrying.runAfter > new Date(), `${retrying.status}, attempt ${retrying.attempts}`);
  await db.update(schema.productionJobs).set({ runAfter: new Date() }).where(eq(schema.productionJobs.id, retrying.id));
  await drain();
  const [retried] = await db.select().from(schema.productionJobs).where(eq(schema.productionJobs.id, retrying.id));
  check("retry: second attempt succeeded", retried.status === "succeeded" && retried.attempts === 2, `${retried.status}, attempt ${retried.attempts}`);

  await fake.close();
  await db.delete(schema.workspaces).where(eq(schema.workspaces.id, ctx.workspaceId));
  await db.execute(sql`delete from auth.users where id = ${userId}`);
  rmSync(workDir, { recursive: true, force: true });

  console.log(failures === 0 ? "\nAll end-to-end checks passed." : `\n${failures} checks FAILED.`);
  console.log(`MP4s: ${outputDir}`);
  await finishProcess(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
