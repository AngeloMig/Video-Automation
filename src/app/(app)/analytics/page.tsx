import { desc, eq, sql } from "drizzle-orm";
import { EmptyState, formatDuration, formatUsd, PageBody, PageHeader, Panel, SetupNotice, Stat } from "@/components/kit";
import { productionJobs, renderedVideos, usageEvents, videoProjects } from "@/db/schema";
import { query } from "@/server/context";

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  const data = await query(async (tx, ctx) => {
    const ws = ctx.workspaceId;
    const [renders] = await tx.select({ n: sql<number>`count(*)::int`, seconds: sql<number>`coalesce(sum(${renderedVideos.durationSeconds}), 0)::float`, ms: sql<number>`coalesce(avg(${renderedVideos.renderMs}), 0)::float`, qa: sql<number>`count(*) filter (where ${renderedVideos.qaPassed})::int` }).from(renderedVideos).where(eq(renderedVideos.workspaceId, ws));
    const [jobs] = await tx.select({ total: sql<number>`count(*)::int`, failed: sql<number>`count(*) filter (where ${productionJobs.status} = 'failed')::int` }).from(productionJobs).where(eq(productionJobs.workspaceId, ws));
    const spend = await tx.select({ kind: usageEvents.kind, provider: usageEvents.provider, unit: usageEvents.unit, quantity: sql<number>`sum(${usageEvents.quantity})::float`, cost: sql<number>`coalesce(sum(${usageEvents.costMicroUsd}), 0)::bigint` }).from(usageEvents).where(eq(usageEvents.workspaceId, ws)).groupBy(usageEvents.kind, usageEvents.provider, usageEvents.unit).orderBy(desc(sql`4`));
    const modes = await tx.select({ mode: videoProjects.mode, n: sql<number>`count(*)::int` }).from(videoProjects).where(eq(videoProjects.workspaceId, ws)).groupBy(videoProjects.mode);
    return { renders, jobs, spend, modes };
  });
  const totalCost = data.spend.reduce((sum, row) => sum + Number(row.cost), 0);
  return (
    <>
      <PageHeader title="Analytics" description="Your production numbers are live. Audience numbers need a connected account." />
      <PageBody>
        <section aria-label="Production">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Videos rendered" value={data.renders.n} />
            <Stat label="Minutes produced" value={(data.renders.seconds / 60).toFixed(1)} />
            <Stat label="QA pass rate" value={data.renders.n ? `${Math.round((data.renders.qa / data.renders.n) * 100)}%` : null} />
            <Stat label="Average render" value={data.renders.n ? formatDuration(data.renders.ms / 1000) : null} />
            <Stat label="Jobs run" value={data.jobs.total} />
            <Stat label="Jobs failed" value={data.jobs.failed} />
            <Stat label="Estimated AI spend" value={formatUsd(totalCost)} hint="From public list prices" />
            <Stat label="Faceless / clips" value={`${data.modes.find((m) => m.mode === "faceless")?.n ?? 0} / ${data.modes.find((m) => m.mode === "clipper")?.n ?? 0}`} />
          </div>
        </section>
        <Panel title="Usage by provider">
          {data.spend.length === 0 ? <EmptyState title="No usage yet" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground"><tr><th className="px-4 py-2 font-normal">Type</th><th className="px-4 py-2 font-normal">Provider</th><th className="px-4 py-2 text-right font-normal">Quantity</th><th className="px-4 py-2 text-right font-normal">Est. cost</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {data.spend.map((row) => (
                    <tr key={`${row.kind}-${row.provider}`}><td className="px-4 py-2 capitalize">{row.kind}</td><td className="readout px-4 py-2 text-muted-foreground">{row.provider}</td><td className="readout px-4 py-2 text-right">{Math.round(row.quantity * 10) / 10} {row.unit}</td><td className="readout px-4 py-2 text-right">{formatUsd(Number(row.cost))}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <SetupNotice title="Audience metrics arrive with publishing in Phase 2">These stay unavailable until a platform reports them. AI recommendations need that data first, so none are shown yet.</SetupNotice>
        <section aria-label="Audience" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {["Views", "Likes", "Comments", "Shares", "Watch time"].map((label) => <Stat key={label} label={label} value={null} />)}
        </section>
      </PageBody>
    </>
  );
}
