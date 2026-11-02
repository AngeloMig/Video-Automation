import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../db/client";
import {
  agentControls,
  auditLogs,
  contentIdeas,
  discoveredVideos,
  mediaAssets,
  nicheKeywords,
  productionJobs,
  projects,
  projectSettings,
  scripts,
  sourceAssets,
  subscriptions,
  transcripts,
  usageEvents,
  videoProjects,
  videoProjectVersions,
  videoScenes,
} from "../db/schema";
import { type AgentName, enqueue } from "../jobs/queue";
import { getPlan } from "../lib/plans";
import { buildClipTimeline, getTemplate, parseScriptScenes } from "../timeline/build";
import { timelineSpecSchema, type TimelineSpec } from "../timeline/spec";

/**
 * Business rules shared by server actions, route handlers and tests. Everything here runs inside
 * withUser, so RLS still decides what this user can see and change.
 */
export type RequestContext = { userId: string; workspaceId: string };

/** A failure the person can act on. Its message is safe to show in the UI. */
export class UserError extends Error {}

async function audit(tx: Tx, ctx: RequestContext, action: string, targetType: string, targetId: string, data?: Record<string, unknown>) {
  await tx.insert(auditLogs).values({ workspaceId: ctx.workspaceId, actorId: ctx.userId, action, targetType, targetId, data: data ?? null });
}

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #58D5C9");

export const projectInputSchema = z.object({
  name: z.string().trim().min(1, "Name the project").max(80),
  niche: z.string().trim().min(1, "Describe the niche").max(200),
  targetAudience: z.string().trim().max(300).optional(),
  language: z.string().trim().min(2).max(10).default("en"),
  region: z.string().trim().max(2).toUpperCase().optional(),
  mode: z.enum(["clipper", "faceless"]),
  keywords: z.array(z.string().trim().min(1)).max(30).default([]),
  excludedKeywords: z.array(z.string().trim().min(1)).max(30).default([]),
  preferredDurationSeconds: z.number().int().min(10).max(180).default(30),
  productionTargetPerWeek: z.number().int().min(0).max(100).default(3),
  brandPrimary: hexColor.default("#58D5C9"),
  brandSecondary: hexColor.default("#77A9FF"),
  template: z.enum(["signal", "documentary", "bold", "podcast", "runner"]).default("signal"),
  tone: z.string().default("educational"),
});
export type ProjectInput = z.input<typeof projectInputSchema>;

async function writeKeywords(tx: Tx, ctx: RequestContext, projectId: string, input: z.output<typeof projectInputSchema>) {
  await tx.delete(nicheKeywords).where(and(eq(nicheKeywords.projectId, projectId), eq(nicheKeywords.workspaceId, ctx.workspaceId)));
  const rows = new Map<string, boolean>();
  for (const keyword of input.keywords) rows.set(keyword.toLowerCase(), false);
  for (const keyword of input.excludedKeywords) rows.set(keyword.toLowerCase(), true);
  if (rows.size > 0) {
    await tx.insert(nicheKeywords).values([...rows].map(([keyword, excluded]) => ({ workspaceId: ctx.workspaceId, projectId, keyword, excluded })));
  }
}

export async function createProject(tx: Tx, ctx: RequestContext, raw: ProjectInput) {
  const input = projectInputSchema.parse(raw);
  const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.workspaceId, ctx.workspaceId));
  const plan = getPlan(sub?.plan);
  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(and(eq(projects.workspaceId, ctx.workspaceId), sql`${projects.archivedAt} is null`));
  if (count >= plan.projects) {
    throw new UserError(`The ${plan.name} plan includes ${plan.projects} active ${plan.projects === 1 ? "project" : "projects"}. Archive one to add another.`);
  }
  const [project] = await tx
    .insert(projects)
    .values({
      workspaceId: ctx.workspaceId,
      name: input.name,
      niche: input.niche,
      targetAudience: input.targetAudience || null,
      language: input.language,
      region: input.region || null,
      mode: input.mode,
    })
    .returning();
  await tx.insert(projectSettings).values({
    workspaceId: ctx.workspaceId,
    projectId: project.id,
    preferredDurationSeconds: input.preferredDurationSeconds,
    productionTargetPerWeek: input.productionTargetPerWeek,
    brandPrimary: input.brandPrimary,
    brandSecondary: input.brandSecondary,
    template: input.template,
    tone: input.tone,
    // New projects always require approval. Autonomous publishing is an explicit opt-in.
    approvalRequired: true,
    autoPublish: false,
  });
  await writeKeywords(tx, ctx, project.id, input);
  await audit(tx, ctx, "project.created", "project", project.id);
  return project;
}

export async function updateProject(tx: Tx, ctx: RequestContext, projectId: string, raw: ProjectInput) {
  const input = projectInputSchema.parse(raw);
  const [project] = await tx
    .update(projects)
    .set({
      name: input.name,
      niche: input.niche,
      targetAudience: input.targetAudience || null,
      language: input.language,
      region: input.region || null,
      mode: input.mode,
    })
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, ctx.workspaceId)))
    .returning();
  if (!project) throw new UserError("You can't edit this project.");
  await tx
    .update(projectSettings)
    .set({
      preferredDurationSeconds: input.preferredDurationSeconds,
      productionTargetPerWeek: input.productionTargetPerWeek,
      brandPrimary: input.brandPrimary,
      brandSecondary: input.brandSecondary,
      template: input.template,
      tone: input.tone,
    })
    .where(eq(projectSettings.projectId, projectId));
  await writeKeywords(tx, ctx, projectId, input);
  await audit(tx, ctx, "project.updated", "project", projectId);
  return project;
}

export async function archiveProject(tx: Tx, ctx: RequestContext, projectId: string) {
  await tx.update(projects).set({ archivedAt: new Date() }).where(and(eq(projects.id, projectId), eq(projects.workspaceId, ctx.workspaceId)));
  await audit(tx, ctx, "project.archived", "project", projectId);
}

async function requireProject(tx: Tx, ctx: RequestContext, projectId: string) {
  const [project] = await tx.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, ctx.workspaceId)));
  if (!project) throw new UserError("Project not found.");
  return project;
}

export const discoveryInputSchema = z.object({
  projectId: z.string().uuid(),
  query: z.string().trim().max(200).optional(),
  channelId: z.string().trim().max(60).optional(),
  youtubeId: z.string().trim().max(20).optional(),
  publishedAfterDays: z.number().int().positive().max(3650).optional(),
  duration: z.enum(["any", "short", "medium", "long"]).optional(),
});

export async function startDiscovery(tx: Tx, ctx: RequestContext, raw: z.input<typeof discoveryInputSchema>) {
  const input = discoveryInputSchema.parse(raw);
  const project = await requireProject(tx, ctx, input.projectId);
  await assertAiBudget(tx, ctx);
  await enqueue(tx, {
    workspaceId: ctx.workspaceId,
    projectId: project.id,
    agent: "discovery",
    kind: "discovery.search",
    label: `Search YouTube: ${input.query || input.youtubeId || project.niche}`,
    payload: input,
  });
}

export async function setDiscoveredStatus(tx: Tx, ctx: RequestContext, id: string, status: "saved" | "dismissed" | "new") {
  await tx.update(discoveredVideos).set({ status }).where(and(eq(discoveredVideos.id, id), eq(discoveredVideos.workspaceId, ctx.workspaceId)));
}

export const facelessInputSchema = z
  .object({
    projectId: z.string().uuid(),
    topic: z.string().trim().max(300).optional(),
    script: z.string().trim().max(6000).optional(),
    title: z.string().trim().max(120).optional(),
    discoveredVideoId: z.string().uuid().optional(),
    durationSeconds: z.number().int().min(10).max(180).default(30),
    tone: z.string().default("educational"),
  })
  .refine((input) => Boolean(input.topic) !== Boolean(input.script), { message: "Enter a topic or your own script." });

/** AI route: research, then script, voice, visuals, render. Manual route: starts at voice. */
export async function createFacelessVideo(tx: Tx, ctx: RequestContext, raw: z.input<typeof facelessInputSchema>) {
  const input = facelessInputSchema.parse(raw);
  const project = await requireProject(tx, ctx, input.projectId);
  await assertRenderQuota(tx, ctx);
  await assertAiBudget(tx, ctx);

  if (input.topic) {
    const [idea] = await tx
      .insert(contentIdeas)
      .values({ workspaceId: ctx.workspaceId, projectId: project.id, topic: input.topic, discoveredVideoId: input.discoveredVideoId ?? null })
      .returning();
    if (input.discoveredVideoId) {
      await tx.update(discoveredVideos).set({ status: "used" }).where(and(eq(discoveredVideos.id, input.discoveredVideoId), eq(discoveredVideos.workspaceId, ctx.workspaceId)));
    }
    const [video] = await tx
      .insert(videoProjects)
      .values({
        workspaceId: ctx.workspaceId,
        projectId: project.id,
        mode: "faceless",
        status: "in_production",
        title: input.title || input.topic.slice(0, 120),
        contentIdeaId: idea.id,
        targetDurationSeconds: input.durationSeconds,
        tone: input.tone,
        generationSettings: { route: "ai", durationSeconds: input.durationSeconds, tone: input.tone },
      })
      .returning();
    await enqueue(tx, {
      workspaceId: ctx.workspaceId,
      projectId: project.id,
      videoProjectId: video.id,
      agent: "research",
      kind: "faceless.research",
      label: `Research: ${input.topic.slice(0, 80)}`,
      payload: { videoProjectId: video.id },
    });
    return video;
  }

  const parsedScenes = parseScriptScenes(input.script!);
  if (parsedScenes.length === 0) throw new UserError("The script needs at least one sentence.");
  const body = parsedScenes.map((scene) => scene.narration).join(" ");
  const title = input.title || parsedScenes[0].narration.slice(0, 80);
  const [video] = await tx
    .insert(videoProjects)
    .values({
      workspaceId: ctx.workspaceId,
      projectId: project.id,
      mode: "faceless",
      status: "in_production",
      title,
      targetDurationSeconds: input.durationSeconds,
      tone: input.tone,
      generationSettings: { route: "manual_script", tone: input.tone },
    })
    .returning();
  await tx.insert(scripts).values({ workspaceId: ctx.workspaceId, videoProjectId: video.id, origin: "manual", title, body, tone: input.tone });
  await tx.insert(videoScenes).values(
    parsedScenes.map(({ narration, visualQuery, speaker, callout }, position) => ({
      workspaceId: ctx.workspaceId,
      videoProjectId: video.id,
      position,
      narration,
      visualQuery,
      speaker,
      callout,
    })),
  );
  await enqueue(tx, {
    workspaceId: ctx.workspaceId,
    projectId: project.id,
    videoProjectId: video.id,
    agent: "voice",
    kind: "faceless.voice",
    label: `Record narration: ${title}`,
    payload: { videoProjectId: video.id },
  });
  return video;
}

export const sceneRegenerationSchema = z.object({
  sceneId: z.string().uuid(),
  narration: z.string().trim().min(1).max(1000).optional(),
  visualQuery: z.string().trim().max(120).optional(),
  regenerateVoice: z.boolean().default(false),
  regenerateVisual: z.boolean().default(false),
});

/** Redoes one scene without restarting the video. The new timeline waits for review. */
export async function regenerateScene(tx: Tx, ctx: RequestContext, raw: z.input<typeof sceneRegenerationSchema>) {
  const input = sceneRegenerationSchema.parse(raw);
  const [scene] = await tx.select().from(videoScenes).where(and(eq(videoScenes.id, input.sceneId), eq(videoScenes.workspaceId, ctx.workspaceId)));
  if (!scene) throw new UserError("Scene not found.");
  const [video] = await tx.select().from(videoProjects).where(eq(videoProjects.id, scene.videoProjectId));

  const narrationChanged = input.narration !== undefined && input.narration !== scene.narration;
  await tx
    .update(videoScenes)
    .set({ narration: input.narration ?? scene.narration, visualQuery: input.visualQuery ?? scene.visualQuery })
    .where(eq(videoScenes.id, scene.id));
  await tx.update(videoProjects).set({ status: "in_production", lastError: null }).where(eq(videoProjects.id, video.id));

  const payload = { videoProjectId: video.id, sceneIds: [scene.id], render: false };
  if (narrationChanged || input.regenerateVoice) {
    // The voice job continues on to visuals, which only redoes footage if this scene is listed.
    await enqueue(tx, {
      workspaceId: ctx.workspaceId,
      projectId: video.projectId,
      videoProjectId: video.id,
      agent: "voice",
      kind: "faceless.voice",
      label: `Re-record scene ${scene.position + 1}: ${video.title}`,
      payload: { videoProjectId: video.id, sceneIds: [scene.id], render: false },
    });
  } else if (input.regenerateVisual) {
    await enqueue(tx, {
      workspaceId: ctx.workspaceId,
      projectId: video.projectId,
      videoProjectId: video.id,
      agent: "visual",
      kind: "faceless.visuals",
      label: `Replace footage in scene ${scene.position + 1}: ${video.title}`,
      payload,
    });
  } else {
    await enqueue(tx, {
      workspaceId: ctx.workspaceId,
      projectId: video.projectId,
      videoProjectId: video.id,
      agent: "editing",
      kind: "edit.assemble",
      label: `Assemble timeline: ${video.title}`,
      payload: { videoProjectId: video.id, render: false },
    });
  }
}

export const sourceRegistrationSchema = z.object({
  projectId: z.string().uuid(),
  mediaAssetId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  rightsBasis: z.enum(["i_created_it", "i_have_a_license", "public_domain"]),
  rightsConfirmed: z.literal(true, { error: "Confirm that you have the rights to this footage." }),
});

export async function registerSource(tx: Tx, ctx: RequestContext, raw: z.input<typeof sourceRegistrationSchema>) {
  const input = sourceRegistrationSchema.parse(raw);
  await requireProject(tx, ctx, input.projectId);
  const [source] = await tx
    .insert(sourceAssets)
    .values({
      workspaceId: ctx.workspaceId,
      projectId: input.projectId,
      mediaAssetId: input.mediaAssetId,
      title: input.title,
      rightsConfirmedBy: ctx.userId,
      rightsConfirmedAt: new Date(),
      rightsBasis: input.rightsBasis,
    })
    .returning();
  await audit(tx, ctx, "source.rights_confirmed", "source_asset", source.id, { basis: input.rightsBasis });
  return source;
}

const clipLimitsSchema = z
  .object({
    sourceAssetId: z.string().uuid(),
    minSeconds: z.number().int().min(5).max(170).default(20),
    maxSeconds: z.number().int().min(10).max(180).default(60),
    clipCount: z.number().int().min(1).max(10).default(5),
  })
  .refine((value) => value.maxSeconds > value.minSeconds, { message: "Longest clip must be longer than the shortest." });

export async function startClipAnalysis(tx: Tx, ctx: RequestContext, raw: z.input<typeof clipLimitsSchema>) {
  const input = clipLimitsSchema.parse(raw);
  const [source] = await tx.select().from(sourceAssets).where(and(eq(sourceAssets.id, input.sourceAssetId), eq(sourceAssets.workspaceId, ctx.workspaceId)));
  if (!source) throw new UserError("Source video not found.");
  await assertAiBudget(tx, ctx);
  const [existing] = await tx.select({ id: transcripts.id }).from(transcripts).where(eq(transcripts.sourceAssetId, source.id));
  await enqueue(tx, {
    workspaceId: ctx.workspaceId,
    projectId: source.projectId,
    agent: "clipping",
    kind: existing ? "clip.detect" : "clip.transcribe",
    label: `${existing ? "Find highlights in" : "Transcribe"} ${source.title}`,
    payload: input,
  });
}

export const manualClipSchema = z
  .object({
    sourceAssetId: z.string().uuid(),
    title: z.string().trim().min(1, "Name the clip").max(120),
    startSeconds: z.number().min(0),
    endSeconds: z.number().positive(),
    focusX: z.number().min(0).max(1).default(0.5),
  })
  .refine((value) => value.endSeconds > value.startSeconds, { message: "The end must be after the start." });

/** Cut by timecode. Works with no AI key; captions appear only if a transcript exists. */
export async function createManualClip(tx: Tx, ctx: RequestContext, raw: z.input<typeof manualClipSchema>) {
  const input = manualClipSchema.parse(raw);
  const [row] = await tx
    .select({ source: sourceAssets, media: mediaAssets })
    .from(sourceAssets)
    .innerJoin(mediaAssets, eq(mediaAssets.id, sourceAssets.mediaAssetId))
    .where(and(eq(sourceAssets.id, input.sourceAssetId), eq(sourceAssets.workspaceId, ctx.workspaceId)));
  if (!row) throw new UserError("Source video not found.");
  if (row.media.durationSeconds && input.endSeconds > row.media.durationSeconds + 0.1) {
    throw new UserError(`This video is only ${row.media.durationSeconds.toFixed(1)} seconds long.`);
  }
  const [settings] = await tx.select().from(projectSettings).where(eq(projectSettings.projectId, row.source.projectId));
  const [transcript] = await tx.select().from(transcripts).where(eq(transcripts.sourceAssetId, row.source.id));
  const timeline = buildClipTimeline({
    sourceAssetId: row.media.id,
    start: input.startSeconds,
    end: input.endSeconds,
    words: transcript?.words ?? [],
    template: getTemplate(settings?.template),
    focusX: input.focusX,
    removeSilence: Boolean(transcript),
    brand: {
      brandPrimary: settings?.brandPrimary ?? "#58D5C9",
      brandSecondary: settings?.brandSecondary ?? "#77A9FF",
      watermarkAssetId: settings?.logoAssetId,
    },
  });
  const [video] = await tx
    .insert(videoProjects)
    .values({
      workspaceId: ctx.workspaceId,
      projectId: row.source.projectId,
      mode: "clipper",
      status: "ready_to_render",
      title: input.title,
      sourceAssetId: row.source.id,
      sourceStartSeconds: input.startSeconds,
      sourceEndSeconds: input.endSeconds,
      timeline,
      timelineVersion: 1,
      generationSettings: { route: "manual_clip" },
    })
    .returning();
  return video;
}

export async function assertRenderQuota(tx: Tx, ctx: RequestContext) {
  const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.workspaceId, ctx.workspaceId));
  const plan = getPlan(sub?.plan);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [{ renders }] = await tx
    .select({ renders: sql<number>`count(*)::int` })
    .from(usageEvents)
    .where(and(eq(usageEvents.workspaceId, ctx.workspaceId), eq(usageEvents.kind, "render"), gte(usageEvents.createdAt, monthStart)));
  if (renders >= plan.monthlyRenders) {
    throw new UserError(`You've used all ${plan.monthlyRenders} renders in the ${plan.name} plan this month.`);
  }
}

/** Stops new AI work once this month's estimated spend reaches the plan's budget. */
export async function assertAiBudget(tx: Tx, ctx: RequestContext) {
  const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.workspaceId, ctx.workspaceId));
  const plan = getPlan(sub?.plan);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [{ spent }] = await tx
    .select({ spent: sql<number>`coalesce(sum(${usageEvents.costMicroUsd}), 0)::bigint` })
    .from(usageEvents)
    .where(and(eq(usageEvents.workspaceId, ctx.workspaceId), gte(usageEvents.createdAt, monthStart)));
  if (Number(spent) >= plan.monthlyAiBudgetUsd * 1_000_000) {
    throw new UserError(`You've reached the ${plan.name} plan's $${plan.monthlyAiBudgetUsd} AI budget for this month.`);
  }
}

export async function assertStorageQuota(tx: Tx, ctx: RequestContext, addingBytes: number) {
  const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.workspaceId, ctx.workspaceId));
  const plan = getPlan(sub?.plan);
  const [{ used }] = await tx
    .select({ used: sql<number>`coalesce(sum(${mediaAssets.sizeBytes}), 0)::bigint` })
    .from(mediaAssets)
    .where(eq(mediaAssets.workspaceId, ctx.workspaceId));
  if (Number(used) + addingBytes > plan.storageGb * 1024 ** 3) {
    throw new UserError(`This upload would go over the ${plan.name} plan's ${plan.storageGb} GB of storage.`);
  }
}

export async function requestRender(tx: Tx, ctx: RequestContext, videoProjectId: string) {
  const [video] = await tx.select().from(videoProjects).where(and(eq(videoProjects.id, videoProjectId), eq(videoProjects.workspaceId, ctx.workspaceId)));
  if (!video) throw new UserError("Video not found.");
  if (!video.timeline) throw new UserError("This video has no timeline yet.");
  await assertRenderQuota(tx, ctx);
  await tx.update(videoProjects).set({ status: "in_production", lastError: null }).where(eq(videoProjects.id, video.id));
  await enqueue(tx, {
    workspaceId: ctx.workspaceId,
    projectId: video.projectId,
    videoProjectId: video.id,
    agent: "editing",
    kind: "render.video",
    label: `Render: ${video.title}`,
    payload: { videoProjectId: video.id },
    // Double-clicking Render can't queue the same timeline version twice.
    idempotencyKey: `render:${video.id}:v${video.timelineVersion}:${Date.now() >> 12}`,
    maxAttempts: 2,
  });
}

export async function setVideoApproval(tx: Tx, ctx: RequestContext, videoProjectId: string, decision: "approved" | "rejected") {
  const [video] = await tx.select().from(videoProjects).where(and(eq(videoProjects.id, videoProjectId), eq(videoProjects.workspaceId, ctx.workspaceId)));
  if (!video) throw new UserError("Video not found.");
  if (decision === "approved" && video.status !== "pending_approval") {
    throw new UserError("Only a rendered video that passed its checks can be approved.");
  }
  await tx
    .update(videoProjects)
    .set({
      status: decision,
      approvedBy: decision === "approved" ? ctx.userId : null,
      approvedAt: decision === "approved" ? new Date() : null,
    })
    .where(eq(videoProjects.id, video.id));
  await audit(tx, ctx, `video.${decision}`, "video_project", video.id, { timelineVersion: video.timelineVersion });
}

export async function deleteVideo(tx: Tx, ctx: RequestContext, videoProjectId: string) {
  await tx.delete(videoProjects).where(and(eq(videoProjects.id, videoProjectId), eq(videoProjects.workspaceId, ctx.workspaceId)));
  await audit(tx, ctx, "video.deleted", "video_project", videoProjectId);
}

/** Editor save. Any edit voids earlier approval, because the rendered file no longer matches. */
export async function saveTimeline(tx: Tx, ctx: RequestContext, videoProjectId: string, rawSpec: unknown, note?: string) {
  const spec: TimelineSpec = timelineSpecSchema.parse(rawSpec);
  const [video] = await tx.select().from(videoProjects).where(and(eq(videoProjects.id, videoProjectId), eq(videoProjects.workspaceId, ctx.workspaceId)));
  if (!video) throw new UserError("Video not found.");
  const version = video.timelineVersion + 1;
  await tx.insert(videoProjectVersions).values({
    workspaceId: ctx.workspaceId,
    videoProjectId,
    version,
    timeline: spec,
    note: note ?? null,
    createdBy: ctx.userId,
  });
  await tx
    .update(videoProjects)
    .set({ timeline: spec, timelineVersion: version, status: video.status === "candidate" ? "candidate" : "ready_to_render", approvedAt: null, approvedBy: null })
    .where(eq(videoProjects.id, videoProjectId));
  return version;
}

export async function restoreTimelineVersion(tx: Tx, ctx: RequestContext, videoProjectId: string, version: number) {
  const [saved] = await tx
    .select()
    .from(videoProjectVersions)
    .where(and(eq(videoProjectVersions.videoProjectId, videoProjectId), eq(videoProjectVersions.version, version), eq(videoProjectVersions.workspaceId, ctx.workspaceId)));
  if (!saved) throw new UserError("That version no longer exists.");
  return saveTimeline(tx, ctx, videoProjectId, saved.timeline, `Restored version ${version}`);
}

async function requireJob(tx: Tx, ctx: RequestContext, jobId: string) {
  const [job] = await tx.select().from(productionJobs).where(and(eq(productionJobs.id, jobId), eq(productionJobs.workspaceId, ctx.workspaceId)));
  if (!job) throw new UserError("Job not found.");
  return job;
}

export async function retryJob(tx: Tx, ctx: RequestContext, jobId: string) {
  const job = await requireJob(tx, ctx, jobId);
  if (job.status !== "failed" && job.status !== "cancelled") throw new UserError("Only a failed or cancelled job can be retried.");
  await tx
    .update(productionJobs)
    .set({ status: "queued", attempts: 0, runAfter: new Date(), progress: 0, errorCode: null, errorMessage: null, finishedAt: null })
    .where(eq(productionJobs.id, job.id));
  if (job.videoProjectId) {
    await tx.update(videoProjects).set({ status: "in_production", lastError: null }).where(eq(videoProjects.id, job.videoProjectId));
  }
}

/** A queued job stops now. A running job is told to stop and the worker confirms it. */
export async function cancelJob(tx: Tx, ctx: RequestContext, jobId: string) {
  const job = await requireJob(tx, ctx, jobId);
  if (job.status === "queued") {
    await tx.update(productionJobs).set({ status: "cancelled", finishedAt: new Date() }).where(eq(productionJobs.id, job.id));
  } else if (job.status === "running") {
    await tx.update(productionJobs).set({ status: "cancel_requested" }).where(eq(productionJobs.id, job.id));
  } else {
    throw new UserError("This job has already finished.");
  }
}

export async function setAgentPaused(tx: Tx, ctx: RequestContext, agent: AgentName, paused: boolean) {
  await tx
    .insert(agentControls)
    .values({ workspaceId: ctx.workspaceId, agent, paused })
    .onConflictDoUpdate({ target: [agentControls.workspaceId, agentControls.agent], set: { paused } });
  await audit(tx, ctx, paused ? "agent.paused" : "agent.resumed", "agent", agent);
}

