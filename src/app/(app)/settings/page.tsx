import { desc, eq } from "drizzle-orm";
import { ExternalLink } from "lucide-react";
import { formatRelative, PageBody, PageHeader, Panel, StatusPill } from "@/components/kit";
import { WorkspaceNameForm } from "@/components/workspace-name-form";
import { auditLogs, users, workspaceMembers } from "@/db/schema";
import { query, requireContext } from "@/server/context";
import { integrationStatuses, type IntegrationState } from "@/services/registry";

export const metadata = { title: "Settings" };

const STATE: Record<IntegrationState, { label: string; tone: "good" | "info" | "warn" | "neutral" }> = {
  connected: { label: "Connected", tone: "good" },
  local: { label: "Local development", tone: "info" },
  not_configured: { label: "Needs setup", tone: "warn" },
  planned: { label: "Later phase", tone: "neutral" },
};

export default async function SettingsPage() {
  const ctx = await requireContext();
  const { members, audit } = await query(async (tx) => ({
    members: await tx.select({ id: workspaceMembers.id, role: workspaceMembers.role, email: users.email }).from(workspaceMembers).innerJoin(users, eq(users.id, workspaceMembers.userId)).where(eq(workspaceMembers.workspaceId, ctx.workspaceId)),
    audit: await tx.select().from(auditLogs).where(eq(auditLogs.workspaceId, ctx.workspaceId)).orderBy(desc(auditLogs.createdAt)).limit(15),
  }));
  return (
    <>
      <PageHeader title="Settings" />
      <PageBody className="max-w-4xl">
        <Panel title="Workspace">
          <WorkspaceNameForm name={ctx.workspaceName} />
        </Panel>
        <Panel title="Members" description="Inviting teammates arrives with Phase 4 team features.">
          <ul className="divide-y divide-border">
            {members.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="truncate">{member.email}</span>
                <StatusPill>{member.role}</StatusPill>
              </li>
            ))}
          </ul>
        </Panel>
        <section id="integrations" className="scroll-mt-6">
          <Panel title="Integrations" description="Keys stay on the server. Set them in your environment, then restart the web app and worker.">
            <ul className="divide-y divide-border">
              {integrationStatuses().map((integration) => (
                <li key={integration.key} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-sm font-medium">{integration.name}</h3>
                      <p className="text-xs text-muted-foreground">{integration.purpose}</p>
                    </div>
                    <StatusPill tone={STATE[integration.state].tone}>{STATE[integration.state].label}</StatusPill>
                  </div>
                  <p className="mt-1.5 text-sm text-muted-foreground">{integration.detail}</p>
                  {integration.state !== "connected" && integration.envVars.length > 0 ? (
                    <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {integration.envVars.map((name) => <code key={name} className="readout rounded bg-muted px-1.5 py-0.5 text-xs">{name}</code>)}
                      {integration.docsUrl ? <a href={integration.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">Get a key <ExternalLink className="size-3" aria-hidden /></a> : null}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </Panel>
        </section>
        {ctx.role === "owner" || ctx.role === "admin" ? (
          <Panel title="Audit log" description="Rights confirmations, approvals and other sensitive changes.">
            {audit.length === 0 ? <p className="px-4 py-3 text-sm text-muted-foreground">Nothing recorded yet.</p> : (
              <ul className="divide-y divide-border">
                {audit.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                    <span className="readout truncate text-muted-foreground">{entry.action}</span>
                    <time className="readout shrink-0 text-xs text-muted-foreground">{formatRelative(entry.createdAt)}</time>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : null}
      </PageBody>
    </>
  );
}
