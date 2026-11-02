import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { serviceDb } from "../db/client";
import { videoProjects, workerHeartbeats } from "../db/schema";
import { claimNextJob, completeJob, failJob, heartbeat, type Job, logAgent, markCancelled } from "../jobs/queue";
import { clipDetect, clipTranscribe } from "../pipelines/clipper";
import { createContext, type JobHandler } from "../pipelines/context";
import { discoverySearch } from "../pipelines/discovery";
import { editAssemble, facelessResearch, facelessScript, facelessVisuals, facelessVoice } from "../pipelines/faceless";
import { qaCheck, renderVideo } from "../pipelines/production";
import { IntegrationMissingError, PermanentError, RateLimitError } from "../services/errors";

export const HANDLERS: Record<string, JobHandler> = {
  "discovery.search": discoverySearch,
  "clip.transcribe": clipTranscribe,
  "clip.detect": clipDetect,
  "faceless.research": facelessResearch,
  "faceless.script": facelessScript,
  "faceless.voice": facelessVoice,
  "faceless.visuals": facelessVisuals,
  "edit.assemble": editAssemble,
  "render.video": renderVideo,
  "qa.check": qaCheck,
};

const LEASE_SECONDS = 60;
const HEARTBEAT_MS = 15_000;

function classify(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof IntegrationMissingError) return { code: error.code, message, retryable: false };
  if (error instanceof PermanentError) return { code: error.code, message, retryable: false };
  if (error instanceof RateLimitError) return { code: error.code, message, retryable: true, retryAfterSeconds: error.retryAfterSeconds };
  return { code: "error", message, retryable: true };
}

export async function runJob(job: Job, workerId: string): Promise<void> {
  const db = serviceDb();
  const controller = new AbortController();
  let stop: "cancelled" | "lost" | null = null;

  const beat = setInterval(async () => {
    try {
      const state = await heartbeat(db, job, workerId, LEASE_SECONDS);
      if (state !== "continue") {
        stop = state;
        controller.abort();
      }
    } catch (error) {
      console.error("heartbeat failed", error);
    }
  }, HEARTBEAT_MS);

  const tmpDir = await mkdtemp(join(tmpdir(), `video-job-${job.id}-`));
  const context = createContext(db, job, controller.signal, tmpDir);
  const agent = job.agent;
  try {
    const handler = HANDLERS[job.kind];
    if (!handler) throw new PermanentError(`No handler for job kind ${job.kind}`, "unknown_job");
    await logAgent(db, { workspaceId: job.workspaceId, jobId: job.id, agent, message: `Started: ${job.label}` });
    const result = (await handler(context)) ?? {};
    await context.flush();

    // A cancel that arrived during the last step still wins over success.
    const state = await heartbeat(db, job, workerId, LEASE_SECONDS);
    if (state === "cancelled") {
      await markCancelled(db, job);
      await logAgent(db, { workspaceId: job.workspaceId, jobId: job.id, agent, message: `Cancelled: ${job.label}`, level: "warn" });
      return;
    }
    if (state === "lost") return;
    await completeJob(db, job, workerId, result);
    await logAgent(db, { workspaceId: job.workspaceId, jobId: job.id, agent, message: `Finished: ${job.label}` });
  } catch (error) {
    await context.flush().catch(() => {});
    if (stop === "lost") return;
    if (stop === "cancelled") {
      await markCancelled(db, job);
      await logAgent(db, { workspaceId: job.workspaceId, jobId: job.id, agent, message: `Cancelled: ${job.label}`, level: "warn" });
      return;
    }
    const failure = classify(error);
    const outcome = await failJob(db, job, workerId, failure);
    await logAgent(db, {
      workspaceId: job.workspaceId,
      jobId: job.id,
      agent,
      level: outcome === "failed" ? "error" : "warn",
      message: outcome === "failed" ? `Failed: ${job.label}. ${failure.message}` : `Will retry (attempt ${job.attempts} of ${job.maxAttempts}): ${failure.message}`,
    });
    if (outcome === "failed" && job.videoProjectId) {
      await db.update(videoProjects).set({ status: "failed", lastError: failure.message.slice(0, 1000) }).where(eq(videoProjects.id, job.videoProjectId));
    }
  } finally {
    clearInterval(beat);
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function recordWorkerHeartbeat(workerId: string) {
  await serviceDb()
    .insert(workerHeartbeats)
    .values({ workerId })
    .onConflictDoUpdate({ target: workerHeartbeats.workerId, set: { lastSeenAt: sql`now()` } });
}

export async function removeWorkerHeartbeat(workerId: string) {
  await serviceDb().delete(workerHeartbeats).where(eq(workerHeartbeats.workerId, workerId));
}

/** Runs jobs until told to stop or, with untilIdle, until the queue has nothing runnable. */
export async function workLoop(options: { workerId: string; shouldStop: () => boolean; untilIdle?: boolean; pollMs?: number }) {
  const db = serviceDb();
  while (!options.shouldStop()) {
    const job = await claimNextJob(db, options.workerId, LEASE_SECONDS);
    if (job) {
      await runJob(job, options.workerId);
      continue;
    }
    if (options.untilIdle) return;
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 1000));
  }
}
