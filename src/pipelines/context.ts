import { sql } from "drizzle-orm";
import type { serviceDb } from "../db/client";
import { productionJobs, usageEvents } from "../db/schema";
import type { Job } from "../jobs/queue";
import { logAgent } from "../jobs/queue";
import type { UsageRecord } from "../services/types";

export type JobContext = {
  /** Owner connection without RLS. Every query must filter by job.workspaceId. */
  db: ReturnType<typeof serviceDb>;
  job: Job;
  workspaceId: string;
  signal: AbortSignal;
  /** Removed after the job finishes, on success or failure. */
  tmpDir: string;
  log(message: string, level?: "info" | "warn" | "error"): Promise<void>;
  progress(fraction: number): Promise<void>;
  usage(record: UsageRecord): void;
  /** Waits for buffered usage writes so a job's cost is complete when it finishes. */
  flush(): Promise<void>;
};

export type JobHandler = (context: JobContext) => Promise<Record<string, unknown> | void>;

export function createContext(db: JobContext["db"], job: Job, signal: AbortSignal, tmpDir: string): JobContext {
  const pending: Promise<unknown>[] = [];
  return {
    db,
    job,
    signal,
    tmpDir,
    workspaceId: job.workspaceId,
    log: (message, level = "info") => logAgent(db, { workspaceId: job.workspaceId, jobId: job.id, agent: job.agent, message, level }),
    progress: async (fraction) => {
      await db.execute(sql`update ${productionJobs} set progress = ${Math.min(Math.max(fraction, 0), 1)} where id = ${job.id}`);
    },
    usage: (record) => {
      pending.push(
        (async () => {
          await db.insert(usageEvents).values({ workspaceId: job.workspaceId, jobId: job.id, ...record });
          if (record.costMicroUsd) {
            await db.execute(sql`update ${productionJobs} set cost_micro_usd = cost_micro_usd + ${record.costMicroUsd} where id = ${job.id}`);
          }
        })(),
      );
    },
    flush: async () => {
      await Promise.all(pending);
    },
  };
}
