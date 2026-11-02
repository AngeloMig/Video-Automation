import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { EmptyState, formatRelative, formatUsd, JobStatus, PageBody, PageHeader, Panel, StatusPill } from "@/components/kit";
import { ActionButton, LiveRefresh } from "@/components/live";
import { productionJobs } from "@/db/schema";
import { cancelJobAction, retryJobAction } from "@/server/actions";
import { query } from "@/server/context";

export const metadata = { title: "Production Queue" };

export default async function QueuePage() {
  const jobs = await query((tx, ctx) => tx.select().from(productionJobs).where(eq(productionJobs.workspaceId, ctx.workspaceId)).orderBy(desc(productionJobs.createdAt)).limit(100));
  const active = jobs.some((job) => ["queued", "running", "cancel_requested"].includes(job.status));
  return (
    <>
      <LiveRefresh active={active} intervalMs={2000} />
      <PageHeader title="Production Queue" description="Every job across both content modes. Failed jobs retry automatically, up to their limit." />
      <PageBody>
        <Panel>
          {jobs.length === 0 ? (
            <EmptyState title="The queue is empty">Jobs appear here when you start a video or a discovery search.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {jobs.map((job) => {
                const waiting = job.status === "queued" && job.attempts > 0;
                return (
                  <li key={job.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
                    <div className="w-24 shrink-0"><StatusPill>{job.agent}</StatusPill></div>
                    <div className="min-w-[200px] flex-1">
                      {job.videoProjectId ? (
                        <Link href={`/videos/${job.videoProjectId}`} className="block truncate text-sm hover:text-primary">{job.label}</Link>
                      ) : (
                        <p className="truncate text-sm">{job.label}</p>
                      )}
                      <p className="readout mt-0.5 text-xs text-muted-foreground">
                        {formatRelative(job.createdAt)}
                        {job.attempts > 1 ? ` · attempt ${job.attempts} of ${job.maxAttempts}` : ""}
                        {job.costMicroUsd > 0 ? ` · ${formatUsd(job.costMicroUsd)} est.` : ""}
                        {waiting ? ` · retrying ${formatRelative(job.runAfter) === "just now" ? "soon" : "after backoff"}` : ""}
                      </p>
                      {job.errorMessage ? <p className="mt-1 text-xs break-words text-destructive">{job.errorMessage}</p> : null}
                      {job.status === "running" ? (
                        <div className="mt-1.5 h-1 max-w-sm overflow-hidden rounded bg-muted">
                          <div className="h-full bg-primary transition-all" style={{ width: `${Math.round(job.progress * 100)}%` }} />
                        </div>
                      ) : null}
                    </div>
                    <JobStatus status={job.status} />
                    <div className="flex w-20 justify-end">
                      {job.status === "failed" || job.status === "cancelled" ? (
                        <ActionButton size="xs" variant="outline" action={retryJobAction.bind(null, job.id)} success="Job queued again">Retry</ActionButton>
                      ) : job.status === "queued" || job.status === "running" ? (
                        <ActionButton size="xs" variant="ghost" action={cancelJobAction.bind(null, job.id)}>Cancel</ActionButton>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </PageBody>
    </>
  );
}
