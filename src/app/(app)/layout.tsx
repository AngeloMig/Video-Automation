import { and, eq, inArray, sql } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { productionJobs, videoProjects } from "@/db/schema";
import { isWorkerOnline, query, requireContext } from "@/server/context";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const [activeJobs, pendingApprovals, workerOnline] = await Promise.all([
    query((tx) =>
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(productionJobs)
        .where(and(eq(productionJobs.workspaceId, ctx.workspaceId), inArray(productionJobs.status, ["queued", "running", "cancel_requested"]))),
    ),
    query((tx) =>
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(videoProjects)
        .where(and(eq(videoProjects.workspaceId, ctx.workspaceId), eq(videoProjects.status, "pending_approval"))),
    ),
    isWorkerOnline(),
  ]);
  return (
    <AppShell
      status={{
        activeJobs: activeJobs[0].count,
        pendingApprovals: pendingApprovals[0].count,
        workerOnline,
        workspaceName: ctx.workspaceName,
        email: ctx.email,
      }}
    >
      {children}
    </AppShell>
  );
}
