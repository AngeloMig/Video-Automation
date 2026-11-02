import { and, desc, eq, sql } from "drizzle-orm";
import { formatRelative, formatUsd, PageBody, PageHeader, Panel, StatusPill } from "@/components/kit";
import { ActionButton, LiveRefresh } from "@/components/live";
import { agentControls, agentTaskLogs, productionJobs } from "@/db/schema";
import type { AgentName } from "@/jobs/queue";
import { setAgentPausedAction } from "@/server/actions";
import { query } from "@/server/context";

export const metadata = { title: "AI Agents" };

const AGENTS: { id: AgentName; name: string; job: string; live: boolean }[] = [
  { id: "discovery", name: "Discovery Agent", job: "Finds niche-relevant YouTube videos and scores them.", live: true },
  { id: "research", name: "Research Agent", job: "Reads sources and separates supported facts from uncertain ones.", live: true },
  { id: "script", name: "Script Agent", job: "Writes original scripts, hooks and calls to action.", live: true },
  { id: "clipping", name: "Clipping Agent", job: "Transcribes authorized videos and finds strong moments.", live: true },
  { id: "visual", name: "Visual Agent", job: "Chooses licensed B-roll for each scene, without repeats.", live: true },
  { id: "voice", name: "Voice Agent", job: "Records narration and measures its timing.", live: true },
  { id: "editing", name: "Editing Agent", job: "Assembles the timeline and renders the video.", live: true },
  { id: "qa", name: "Quality Assurance Agent", job: "Checks dimensions, duration, audio and captions in the file.", live: true },
  { id: "publishing", name: "Publishing Agent", job: "Schedules and publishes approved videos.", live: false },
  { id: "analytics", name: "Analytics Agent", job: "Collects performance data and recommends improvements.", live: false },
];

export default async function AgentsPage() {
  const data = await query(async (tx, ctx) => {
    const stats = await tx
      .select({
        agent: productionJobs.agent,
        running: sql<number>`count(*) filter (where ${productionJobs.status} in ('running', 'cancel_requested'))::int`,
        queued: sql<number>`count(*) filter (where ${productionJobs.status} = 'queued')::int`,
        succeeded: sql<number>`count(*) filter (where ${productionJobs.status} = 'succeeded')::int`,
        failed: sql<number>`count(*) filter (where ${productionJobs.status} = 'failed')::int`,
        cost: sql<number>`coalesce(sum(${productionJobs.costMicroUsd}), 0)::bigint`,
        current: sql<string | null>`(array_agg(${productionJobs.label} order by ${productionJobs.startedAt} desc) filter (where ${productionJobs.status} = 'running'))[1]`,
      })
      .from(productionJobs)
      .where(eq(productionJobs.workspaceId, ctx.workspaceId))
      .groupBy(productionJobs.agent);
    const controls = await tx.select().from(agentControls).where(eq(agentControls.workspaceId, ctx.workspaceId));
    const logs = await tx
      .select()
      .from(agentTaskLogs)
      .where(and(eq(agentTaskLogs.workspaceId, ctx.workspaceId)))
      .orderBy(desc(agentTaskLogs.createdAt))
      .limit(150);
    return { stats, controls, logs };
  });
  const anyActive = data.stats.some((row) => row.running + row.queued > 0);
  return (
    <>
      <LiveRefresh active={anyActive} />
      <PageHeader title="AI Agents" description="Each agent is a set of background jobs with real status. Pausing one holds its queued jobs, and anything already running finishes." />
      <PageBody>
        <div className="grid gap-3 lg:grid-cols-2">
          {AGENTS.map((agent) => {
            const stat = data.stats.find((row) => row.agent === agent.id);
            const paused = data.controls.find((control) => control.agent === agent.id)?.paused ?? false;
            const logs = data.logs.filter((log) => log.agent === agent.id).slice(0, 3);
            return (
              <Panel key={agent.id} className="flex flex-col">
                <div className="flex items-start justify-between gap-3 px-4 pt-3">
                  <div className="min-w-0">
                    <h2 className="text-sm font-medium">{agent.name}</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">{agent.job}</p>
                  </div>
                  {!agent.live ? <StatusPill>Phase 2</StatusPill> : paused ? <StatusPill tone="warn">Paused</StatusPill> : stat?.running ? <StatusPill tone="active" pulse>Working</StatusPill> : stat?.queued ? <StatusPill tone="info">Queued</StatusPill> : <StatusPill>Idle</StatusPill>}
                </div>
                {stat?.current ? <p className="mt-2 truncate px-4 text-xs"><span className="text-muted-foreground">Now: </span>{stat.current}</p> : null}
                <dl className="readout mt-3 grid grid-cols-4 gap-px border-y border-border bg-border text-center">
                  {([["Done", stat?.succeeded ?? 0], ["Failed", stat?.failed ?? 0], ["Queued", stat?.queued ?? 0], ["Est. cost", formatUsd(Number(stat?.cost ?? 0))]] as const).map(([label, value]) => (
                    <div key={label} className="bg-card py-2">
                      <dd className="text-sm">{value}</dd>
                      <dt className="font-sans text-[10px] text-muted-foreground">{label}</dt>
                    </div>
                  ))}
                </dl>
                <ol className="flex-1 space-y-1.5 px-4 py-3 text-xs">
                  {logs.length === 0 ? <li className="text-muted-foreground">No activity yet.</li> : null}
                  {logs.map((log) => (
                    <li key={log.id} className="flex gap-2">
                      <span className={`min-w-0 flex-1 break-words ${log.level === "error" ? "text-destructive" : log.level === "warn" ? "text-[color:var(--warning)]" : "text-muted-foreground"}`}>{log.message}</span>
                      <time className="readout shrink-0 text-muted-foreground">{formatRelative(log.createdAt)}</time>
                    </li>
                  ))}
                </ol>
                {agent.live ? (
                  <div className="border-t border-border px-4 py-2">
                    <ActionButton size="xs" variant="ghost" action={setAgentPausedAction.bind(null, agent.id, !paused)}>{paused ? "Resume agent" : "Pause agent"}</ActionButton>
                  </div>
                ) : null}
              </Panel>
            );
          })}
        </div>
      </PageBody>
    </>
  );
}
