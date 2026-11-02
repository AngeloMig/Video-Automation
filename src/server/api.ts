import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { withUser } from "@/db/client";
import { workspaceMembers } from "@/db/schema";
import { getSession } from "@/lib/auth";
import type { RequestContext } from "./domain";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** IDs from a URL are checked first, because Postgres rejects a malformed uuid with an error. */
export function isUuid(value: string) {
  return UUID.test(value);
}

export function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/** Route handler auth: returns null instead of redirecting, so clients get a clean 401. */
export async function getSessionContext(): Promise<RequestContext | null> {
  const session = await getSession();
  if (!session) return null;
  const [membership] = await withUser(session.userId, (tx) =>
    tx.select().from(workspaceMembers).where(eq(workspaceMembers.userId, session.userId)).orderBy(asc(workspaceMembers.createdAt)).limit(1),
  );
  return membership ? { userId: session.userId, workspaceId: membership.workspaceId } : null;
}
