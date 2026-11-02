import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbLike } from "../db/client";
import { agentTaskLogs, productionJobs } from "../db/schema";

export type AgentName = (typeof productionJobs.$inferSelect)["agent"];
export type Job = typeof productionJobs.$inferSelect;

export type EnqueueInput = {
  workspaceId: string;
  projectId?: string | null;
  videoProjectId?: string | null;
  agent: AgentName;
  kind: string;
  label: string;
  payload?: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number;
  /** Same key in one workspace enqueues once, so a retried parent can't double-queue a child. */
  idempotencyKey?: string;
};

export async function enqueue(db: DbLike, input: EnqueueInput): Promise<void> {
  await db
    .insert(productionJobs)
    .values({
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      videoProjectId: input.videoProjectId ?? null,
      agent: input.agent,
      kind: input.kind,
      label: input.label,
      payload: input.payload ?? {},
      priority: input.priority ?? 0,
      maxAttempts: input.maxAttempts ?? 4,
      idempotencyKey: input.idempotencyKey ?? null,
    })
    .onConflictDoNothing();
}

/**
 * Takes the next runnable job, or reclaims one whose worker died and let its lease expire.
 * SKIP LOCKED lets any number of workers run against the same table.
 */
export async function claimNextJob(db: DbLike, workerId: string, leaseSeconds: number): Promise<Job | null> {
  const rows = await db.execute(sql`
    update production_jobs set
      status = 'running',
      attempts = attempts + 1,
      lease_owner = ${workerId},
      lease_expires_at = now() + make_interval(secs => ${leaseSeconds}),
      started_at = coalesce(started_at, now()),
      error_code = null,
      error_message = null,
      updated_at = now()
    where id = (
      select j.id from production_jobs j
      where (
        (j.status = 'queued' and j.run_after <= now())
        or (j.status = 'running' and j.lease_expires_at < now())
      )
      and not exists (
        select 1 from agent_controls c
        where c.workspace_id = j.workspace_id and c.agent = j.agent and c.paused
      )
      order by j.priority desc, j.created_at
      for update skip locked
      limit 1
    )
    returning id
  `);
  const claimed = rows[0] as { id: string } | undefined;
  if (!claimed) return null;
  const [job] = await db.select().from(productionJobs).where(eq(productionJobs.id, claimed.id));
  return job ?? null;
}

/**
 * Extends the lease and reports whether this worker should stop. A worker that lost its lease,
 * or whose job was cancelled, must stop so a reclaimed job doesn't run twice.
 */
export async function heartbeat(
  db: DbLike,
  job: Pick<Job, "id">,
  workerId: string,
  leaseSeconds: number,
): Promise<"continue" | "cancelled" | "lost"> {
  const [row] = await db
    .select({ status: productionJobs.status, leaseOwner: productionJobs.leaseOwner })
    .from(productionJobs)
    .where(eq(productionJobs.id, job.id));
  if (!row || row.leaseOwner !== workerId) return "lost";
  if (row.status === "cancel_requested") return "cancelled";
  if (row.status !== "running") return "lost";
  await db
    .update(productionJobs)
    .set({ leaseExpiresAt: sql`now() + make_interval(secs => ${leaseSeconds})` })
    .where(and(eq(productionJobs.id, job.id), eq(productionJobs.leaseOwner, workerId)));
  return "continue";
}

export function backoffSeconds(attempts: number, random = Math.random) {
  const base = Math.min(15 * 2 ** Math.max(attempts - 1, 0), 900);
  return Math.round(base * (0.75 + random() * 0.5));
}

export async function completeJob(db: DbLike, job: Pick<Job, "id">, workerId: string, result: Record<string, unknown>) {
  const rows = await db
    .update(productionJobs)
    .set({ status: "succeeded", progress: 1, result, finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null })
    .where(and(eq(productionJobs.id, job.id), eq(productionJobs.leaseOwner, workerId), inArray(productionJobs.status, ["running", "cancel_requested"])))
    .returning({ id: productionJobs.id });
  return rows.length === 1;
}

export type FailureInput = { code: string; message: string; retryable: boolean; retryAfterSeconds?: number };

/** Returns "retrying" or "failed" so the caller can decide whether to flag the video. */
export async function failJob(db: DbLike, job: Job, workerId: string, failure: FailureInput): Promise<"retrying" | "failed"> {
  const willRetry = failure.retryable && job.attempts < job.maxAttempts;
  const delay = failure.retryAfterSeconds ?? backoffSeconds(job.attempts);
  await db
    .update(productionJobs)
    .set({
      status: willRetry ? "queued" : "failed",
      errorCode: failure.code,
      errorMessage: failure.message.slice(0, 2000),
      runAfter: willRetry ? sql`now() + make_interval(secs => ${delay})` : undefined,
      finishedAt: willRetry ? null : new Date(),
      leaseOwner: null,
      leaseExpiresAt: null,
    })
    .where(and(eq(productionJobs.id, job.id), eq(productionJobs.leaseOwner, workerId)));
  return willRetry ? "retrying" : "failed";
}

export async function markCancelled(db: DbLike, job: Pick<Job, "id">) {
  await db
    .update(productionJobs)
    .set({ status: "cancelled", finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null })
    .where(eq(productionJobs.id, job.id));
}

export async function logAgent(
  db: DbLike,
  entry: { workspaceId: string; jobId?: string; agent: AgentName; message: string; level?: "info" | "warn" | "error"; data?: Record<string, unknown> },
) {
  await db.insert(agentTaskLogs).values({
    workspaceId: entry.workspaceId,
    jobId: entry.jobId ?? null,
    agent: entry.agent,
    level: entry.level ?? "info",
    message: entry.message,
    data: entry.data ?? null,
  });
}
