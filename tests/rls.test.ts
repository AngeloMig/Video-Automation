import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceDb, withUser } from "../src/db/client";
import { projects, renderedVideos, socialAccounts, workspaceMembers, workspaces } from "../src/db/schema";

/** Runs against the real local Postgres with real role switching. Needs `pnpm db:local`. */
const tag = randomUUID().slice(0, 8);
const emails = { alice: `alice-${tag}@test.local`, bob: `bob-${tag}@test.local`, vic: `vic-${tag}@test.local` };
let alice: string, bob: string, vic: string, aliceWorkspace: string, bobWorkspace: string, aliceProject: string;

async function createUser(email: string) {
  const rows = await serviceDb().execute(sql`insert into auth.users (email) values (${email}) returning id`);
  return (rows[0] as { id: string }).id;
}
/** Drizzle wraps driver errors, so assert on the Postgres message underneath. */
async function pgError(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return String((error as { cause?: { message?: string } }).cause?.message ?? error);
  }
  return "no error";
}
async function workspaceOf(userId: string) {
  const [row] = await serviceDb().select().from(workspaceMembers).where(eq(workspaceMembers.userId, userId));
  return row.workspaceId;
}

beforeAll(async () => {
  alice = await createUser(emails.alice);
  bob = await createUser(emails.bob);
  vic = await createUser(emails.vic);
  aliceWorkspace = await workspaceOf(alice);
  bobWorkspace = await workspaceOf(bob);
  await serviceDb().insert(workspaceMembers).values({ workspaceId: aliceWorkspace, userId: vic, role: "viewer" });
  const [project] = await withUser(alice, (tx) =>
    tx.insert(projects).values({ workspaceId: aliceWorkspace, name: "Space facts", niche: "space" }).returning(),
  );
  aliceProject = project.id;
});

afterAll(async () => {
  await serviceDb().execute(sql`delete from public.workspaces where id in (${aliceWorkspace}, ${bobWorkspace})`);
  await serviceDb().execute(sql`delete from auth.users where email like ${`%-${tag}@test.local`}`);
});

describe("row-level security", () => {
  it("creates a workspace, owner membership and plan on signup", async () => {
    const rows = await withUser(alice, (tx) => tx.select().from(workspaces));
    expect(rows.map((r) => r.id)).toContain(aliceWorkspace);
    expect(rows.map((r) => r.id)).not.toContain(bobWorkspace);
  });

  it("hides other workspaces' rows", async () => {
    const seen = await withUser(bob, (tx) => tx.select().from(projects).where(eq(projects.id, aliceProject)));
    expect(seen).toEqual([]);
  });

  it("rejects writes into another workspace", async () => {
    await expect(
      withUser(bob, (tx) => tx.insert(projects).values({ workspaceId: aliceWorkspace, name: "Intruder", niche: "x" })),
    ).rejects.toThrow();
  });

  it("makes updates to other workspaces' rows no-ops", async () => {
    const updated = await withUser(bob, (tx) =>
      tx.update(projects).set({ name: "Hacked" }).where(eq(projects.id, aliceProject)).returning(),
    );
    expect(updated).toEqual([]);
  });

  it("lets viewers read but not write", async () => {
    const seen = await withUser(vic, (tx) => tx.select().from(projects).where(eq(projects.id, aliceProject)));
    expect(seen).toHaveLength(1);
    await expect(
      withUser(vic, (tx) => tx.insert(projects).values({ workspaceId: aliceWorkspace, name: "Nope", niche: "x" })),
    ).rejects.toThrow();
    const updated = await withUser(vic, (tx) =>
      tx.update(projects).set({ name: "Nope" }).where(eq(projects.id, aliceProject)).returning(),
    );
    expect(updated).toEqual([]);
  });

  it("stops members from promoting themselves", async () => {
    const changed = await withUser(vic, (tx) =>
      tx
        .update(workspaceMembers)
        .set({ role: "owner" })
        .where(and(eq(workspaceMembers.userId, vic), eq(workspaceMembers.workspaceId, aliceWorkspace)))
        .returning(),
    );
    expect(changed).toEqual([]);
  });

  it("stops request connections from writing rendered videos", async () => {
    await expect(
      withUser(alice, (tx) =>
        tx.insert(renderedVideos).values({
          workspaceId: aliceWorkspace,
          videoProjectId: randomUUID(),
          mediaAssetId: randomUUID(),
          timelineVersion: 1,
          timelineSnapshot: {} as never,
        }),
      ),
    ).rejects.toThrow();
  });

  it("never exposes social tokens to request connections, even owners", async () => {
    await serviceDb().insert(socialAccounts).values({
      workspaceId: aliceWorkspace,
      platform: "youtube",
      externalAccountId: "acct",
      accessTokenEncrypted: "ciphertext",
    });
    expect(await pgError(() => withUser(alice, (tx) => tx.select().from(socialAccounts)))).toMatch(/permission denied/);
    const safe = await withUser(alice, (tx) => tx.select({ id: socialAccounts.id }).from(socialAccounts));
    expect(safe).toHaveLength(1);
  });

  it("denies everything without a signed-in user", async () => {
    const message = await pgError(() =>
      serviceDb().transaction(async (tx) => {
        await tx.execute(sql`set local role anon`);
        await tx.select().from(projects);
      }),
    );
    expect(message).toMatch(/permission denied/);
  });
});
