import { and, eq, gte, sql } from "drizzle-orm";
import { PageBody, PageHeader, Panel, SetupNotice, Stat, StatusPill } from "@/components/kit";
import { mediaAssets, subscriptions, usageEvents } from "@/db/schema";
import { getPlan, PLANS } from "@/lib/plans";
import { cn } from "@/lib/utils";
import { query } from "@/server/context";

export const metadata = { title: "Billing" };

export default async function BillingPage() {
  const data = await query(async (tx, ctx) => {
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.workspaceId, ctx.workspaceId));
    const [usage] = await tx
      .select({
        renders: sql<number>`count(*) filter (where ${usageEvents.kind} = 'render')::int`,
        cost: sql<number>`coalesce(sum(${usageEvents.costMicroUsd}), 0)::bigint`,
      })
      .from(usageEvents)
      .where(and(eq(usageEvents.workspaceId, ctx.workspaceId), gte(usageEvents.createdAt, monthStart)));
    const [storage] = await tx.select({ bytes: sql<number>`coalesce(sum(${mediaAssets.sizeBytes}), 0)::bigint` }).from(mediaAssets).where(eq(mediaAssets.workspaceId, ctx.workspaceId));
    return { sub, usage, storage };
  });
  const plan = getPlan(data.sub?.plan);
  return (
    <>
      <PageHeader title="Billing" description="Usage is metered now. Paid plans arrive with Stripe in Phase 4." />
      <PageBody>
        <SetupNotice title="Stripe isn't connected yet" envVars={["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]}>Every workspace is on Starter, with its limits enforced. Plan limits below are starting values you can change in src/lib/plans.ts.</SetupNotice>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Stat label="Renders this month" value={`${data.usage.renders} / ${plan.monthlyRenders}`} />
          <Stat label="Estimated AI spend this month" value={`$${(Number(data.usage.cost) / 1e6).toFixed(2)}`} hint={`Plan budget: $${plan.monthlyAiBudgetUsd}`} />
          <Stat label="Storage used" value={`${(Number(data.storage.bytes) / 1024 ** 3).toFixed(2)} GB`} hint={`Plan limit: ${plan.storageGb} GB`} />
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((option) => (
            <Panel key={option.id} className={cn("p-4", option.id === plan.id && "border-primary/50")}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-medium">{option.name}</h2>
                {option.id === plan.id ? <StatusPill tone="good">Current plan</StatusPill> : null}
              </div>
              <ul className="readout mt-3 space-y-1 text-xs text-muted-foreground">
                <li>{option.monthlyRenders} renders / month</li>
                <li>${option.monthlyAiBudgetUsd} AI budget / month</li>
                <li>{option.storageGb} GB storage</li>
                <li>{option.projects} {option.projects === 1 ? "project" : "projects"}</li>
              </ul>
              <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                {option.features.map((feature) => <li key={feature}>{feature}</li>)}
              </ul>
            </Panel>
          ))}
        </div>
      </PageBody>
    </>
  );
}
