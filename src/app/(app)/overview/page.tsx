import { and, desc, eq, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { AgentGraph, type AgentActivity } from "@/components/agent-graph";
import { EmptyState, formatRelative, PageBody, PageHeader, Panel, Stat, StatusPill, VideoStatus } from "@/components/kit";
import { LiveRefresh } from "@/components/live";
import { buttonVariants } from "@/components/ui/button";
import { agentTaskLogs, discoveredVideos, productionJobs, projects, renderedVideos, scheduledPosts, videoProjects } from "@/db/schema";
import { query } from "@/server/context";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const data = await query(async (tx, ctx) => {
    const ws = ctx.workspaceId;
    const count = async (table: typeof discoveredVideos | typeof renderedVideos | typeof scheduledPosts | typeof projects) =>
      (await tx.select({ n: sql<number>`count(*)::int` }).from(table).where(eq(table.workspaceId, ws)))[0].n;
    const [discovered, generated, scheduled, projectCount] = await Promise.all([count(discoveredVideos), count(renderedVideos), count(scheduledPosts), count(projects)]);
    const statuses = await tx
      .select({ status: videoProjects.status, n: sql<number>`count(*)::int` })
      .from(videoProjects)
      .where(eq(videoProjects.workspaceId, ws))
      .groupBy(videoProjects.status);
    const agents = await tx
      .select({ agent: productionJobs.agent, status: productionJobs.status, n: sql<number>`count(*)::int` })
      .from(productionJobs)
      .where(and(eq(productionJobs.workspaceId, ws), inArray(productionJobs.status, ["queued", "running", "failed", "cancel_requested"])))
      .groupBy(productionJobs.agent, productionJobs.status);
    const activity = await tx.select().from(agentTaskLogs).where(eq(agentTaskLogs.workspaceId, ws)).orderBy(desc(agentTaskLogs.createdAt)).limit(14);
    const approvals = await tx
      .select()
      .from(videoProjects)
      .where(and(eq(videoProjects.workspaceId, ws), eq(videoProjects.status, "pending_approval")))
      .orderBy(desc(videoProjects.updatedAt))
      .limit(5);
    return { discovered, generated, scheduled, projectCount, statuses, agents, activity, approvals };
  });

  const byStatus = Object.fromEntries(data.statuses.map((row) => [row.status, row.n]));
  const agentActivity: AgentActivity = {};
  for (const row of data.agents) {
    const entry = (agentActivity[row.agent] ??= { running: 0, queued: 0, failed: 0 });
    if (row.status === "running" || row.status === "cancel_requested") entry.running += row.n;
    if (row.status === "queued") entry.queued += row.n;
    if (row.status === "failed") entry.failed += row.n;
  }
  const activeAgents = Object.values(agentActivity).filter((agent) => agent.running > 0).length;
  const hasActiveWork = Object.values(agentActivity).some((agent) => agent.running + agent.queued > 0);

  const pipeline = [
    { label: "Candidates", value: byStatus.candidate ?? 0 },
    { label: "In production", value: (byStatus.in_production ?? 0) + (byStatus.rendering ?? 0) },
    { label: "Ready to render", value: byStatus.ready_to_render ?? 0 },
    { label: "Needs approval", value: byStatus.pending_approval ?? 0 },
    { label: "Approved", value: byStatus.approved ?? 0 },
    { label: "Failed", value: byStatus.failed ?? 0 },
  ];

  if (data.projectCount === 0) {
    return (
      <>
        <PageHeader title="Overview" />
        <PageBody>
          <Panel>
            <EmptyState
              title="Create your first content project"
              action={
                <Link href="/projects/new" className={buttonVariants()}>
                  Create project
                </Link>
              }
            >
              A project holds one niche or channel, with its own branding, queue and results. Everything you produce starts there.
            </EmptyState>
          </Panel>
        </PageBody>
      </>
    );
  }

  return (
    <>
      <LiveRefresh active={hasActiveWork} />
      <PageHeader title="Overview" description="What your agents are doing now, and what's waiting for you." />
      <PageBody>
        <Panel title="Production line" description="Lights up only when a real job is running.">
          <div className="px-3 py-2">
            <AgentGraph activity={agentActivity} />
          </div>
        </Panel>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Videos discovered" value={data.discovered} href="/discovery" />
          <Stat label="Videos generated" value={data.generated} href="/published" />
          <Stat label="Pending approvals" value={byStatus.pending_approval ?? 0} href="/published" />
          <Stat label="Active agents" value={activeAgents} href="/agents" />
          <Stat label="Videos published" value={0} hint="Publishing arrives in Phase 2" />
          <Stat label="Scheduled content" value={data.scheduled} href="/calendar" />
          <Stat label="Total views" value={null} hint="Needs a connected account" />
          <Stat label="Engagement" value={null} hint="Needs a connected account" />
        </div>

        <div className="grid gap-6 lg:grid-cols-5">
          <Panel title="Recent AI activity" className="lg:col-span-3">
            {data.activity.length === 0 ? (
              <EmptyState title="No activity yet">Start a video or a discovery search, and each step appears here.</EmptyState>
            ) : (
              <ol className="divide-y divide-border">
                {data.activity.map((entry) => (
                  <li key={entry.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                    <StatusPill tone={entry.level === "error" ? "bad" : entry.level === "warn" ? "warn" : "neutral"}>{entry.agent}</StatusPill>
                    <span className="min-w-0 flex-1 break-words text-muted-foreground">{entry.message}</span>
                    <time className="readout shrink-0 text-xs text-muted-foreground" dateTime={entry.createdAt.toISOString()}>
                      {formatRelative(entry.createdAt)}
                    </time>
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <div className="space-y-6 lg:col-span-2">
            <Panel title="Pipeline status">
              <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-2">
                {pipeline.map((stage) => (
                  <div key={stage.label} className="bg-card px-4 py-2.5">
                    <dt className="text-xs text-muted-foreground">{stage.label}</dt>
                    <dd className="readout mt-0.5 text-lg">{stage.value}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
            <Panel title="Waiting for your approval">
              {data.approvals.length === 0 ? (
                <EmptyState title="Nothing to approve" />
              ) : (
                <ul className="divide-y divide-border">
                  {data.approvals.map((video) => (
                    <li key={video.id}>
                      <Link href={`/videos/${video.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-muted/40">
                        <span className="truncate">{video.title}</span>
                        <VideoStatus status={video.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Platform performance">
              <p className="px-4 py-3 text-sm text-muted-foreground">Unavailable until you connect a social account. Publishing and platform metrics arrive in Phase 2.</p>
            </Panel>
          </div>
        </div>
      </PageBody>
    </>
  );
}
