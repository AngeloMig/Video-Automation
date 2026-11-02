import { asc, desc, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { ZodError } from "zod";
import { serviceDb, type Tx, withUser } from "@/db/client";
import { projects, workerHeartbeats, workspaceMembers, workspaces } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { type RequestContext, UserError } from "./domain";

export type AppContext = RequestContext & {
  email: string;
  workspaceName: string;
  role: "owner" | "admin" | "editor" | "viewer";
};

/** The signed-in user's workspace. Signed-out requests go to the login page. */
export const requireContext = cache(async (): Promise<AppContext> => {
  const session = await getSession();
  if (!session) redirect("/login");
  const [membership] = await withUser(session.userId, (tx) =>
    tx
      .select({ workspaceId: workspaceMembers.workspaceId, role: workspaceMembers.role, name: workspaces.name })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, session.userId))
      .orderBy(asc(workspaceMembers.createdAt))
      .limit(1),
  );
  if (!membership) redirect("/login");
  return { userId: session.userId, email: session.email, workspaceId: membership.workspaceId, workspaceName: membership.name, role: membership.role };
});

/** Page data runs under RLS as the signed-in user. */
export async function query<T>(fn: (tx: Tx, ctx: AppContext) => Promise<T>): Promise<T> {
  const ctx = await requireContext();
  return withUser(ctx.userId, (tx) => fn(tx, ctx));
}

export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

/** Turns thrown errors into messages a person can act on. Unexpected errors stay on the server. */
export async function runAction<T>(fn: (tx: Tx, ctx: AppContext) => Promise<T>): Promise<ActionResult<T>> {
  const ctx = await requireContext();
  try {
    return { ok: true, data: await withUser(ctx.userId, (tx) => fn(tx, ctx)) };
  } catch (error) {
    if (error instanceof UserError) return { ok: false, error: error.message };
    if (error instanceof ZodError) return { ok: false, error: error.issues[0]?.message ?? "Check the form and try again." };
    const cause = String((error as { cause?: { message?: string } }).cause?.message ?? "");
    if (cause.includes("row-level security") || cause.includes("permission denied")) {
      return { ok: false, error: "Your role in this workspace doesn't allow this." };
    }
    console.error(error);
    return { ok: false, error: "Something went wrong on the server. Try again." };
  }
}

export async function listProjects() {
  return query((tx, ctx) =>
    tx
      .select()
      .from(projects)
      .where(sql`${projects.workspaceId} = ${ctx.workspaceId} and ${projects.archivedAt} is null`)
      .orderBy(desc(projects.createdAt)),
  );
}

/** True when a worker checked in during the last 30 seconds. Heartbeats aren't workspace data. */
export async function isWorkerOnline() {
  const [row] = await serviceDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(workerHeartbeats)
    .where(sql`${workerHeartbeats.lastSeenAt} > now() - interval '30 seconds'`);
  return (row?.count ?? 0) > 0;
}
