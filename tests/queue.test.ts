import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { serviceDb, withUser } from "../src/db/client";
import { agentControls, mediaAssets, productionJobs, projects, subscriptions, usageEvents, videoProjects, workspaceMembers } from "../src/db/schema";
import { claimNextJob, completeJob, enqueue, failJob, heartbeat } from "../src/jobs/queue";
import * as domain from "../src/server/domain";
import { buildClipTimeline, getTemplate } from "../src/timeline/build";
import { runJob } from "../src/worker/runner";

/** Durability rules, on real Postgres. Other workspaces' jobs can exist, so claims are filtered here. */
const tag = Date.now();
const db = serviceDb();
let userId: string, workspaceId: string, otherUser: string, otherWorkspace: string, projectId: string;

async function createUser(email: string) {
  const [{ id }] = (await db.execute(sql`insert into auth.users (email) values (${email}) returning id`)) as unknown as { id: string }[];
  const [member] = await db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, id));
  return { id, workspaceId: member.workspaceId };
}

const jobs = () => db.select().from(productionJobs).where(eq(productionJobs.workspaceId, workspaceId));
const add = (kind = "test.job", extra: Partial<Parameters<typeof enqueue>[1]> = {}) =>
  enqueue(db, { workspaceId, agent: "editing", kind, label: "Test job", ...extra });

/** Claims this suite's job even if another run left something else in the shared queue. */
async function claim(worker: string, lease = 60) {
  const others = await db.select({ id: productionJobs.id }).from(productionJobs).where(sql`${productionJobs.workspaceId} <> ${workspaceId} and ${productionJobs.status} = 'queued'`);
  expect(others).toEqual([]);
  return claimNextJob(db, worker, lease);
}

beforeAll(async () => {
  ({ id: userId, workspaceId } = await createUser(`queue-${tag}@test.local`));
  ({ id: otherUser, workspaceId: otherWorkspace } = await createUser(`queue-other-${tag}@test.local`));
  await db.update(subscriptions).set({ plan: "pro" }).where(eq(subscriptions.workspaceId, workspaceId));
  const [project] = await db.insert(projects).values({ workspaceId, name: "Queue", niche: "tests" }).returning();
  projectId = project.id;
});

beforeEach(async () => {
  await db.delete(productionJobs).where(eq(productionJobs.workspaceId, workspaceId));
  await db.delete(agentControls).where(eq(agentControls.workspaceId, workspaceId));
});

afterAll(async () => {
  await db.execute(sql`delete from public.workspaces where id in (${workspaceId}, ${otherWorkspace})`);
  await db.execute(sql`delete from auth.users where id in (${userId}, ${otherUser})`);
});

describe("production queue", () => {
  it("gives a job to exactly one of many competing workers", async () => {
    await add();
    const claims = await Promise.all(Array.from({ length: 8 }, (_, i) => claimNextJob(db, `worker-${i}`, 60)));
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("enqueues an idempotency key only once", async () => {
    await add("test.job", { idempotencyKey: "same" });
    await add("test.job", { idempotencyKey: "same" });
    expect(await jobs()).toHaveLength(1);
  });

  it("reclaims a job whose worker died, and fences the dead worker out", async () => {
    await add();
    const first = await claim("dead-worker");
    await db.update(productionJobs).set({ leaseExpiresAt: new Date(Date.now() - 1000) }).where(eq(productionJobs.id, first!.id));

    const second = await claim("live-worker");
    expect(second?.id).toBe(first?.id);
    expect(second?.attempts).toBe(2);

    // The worker that lost its lease can neither finish the job nor keep running.
    expect(await completeJob(db, first!, "dead-worker", {})).toBe(false);
    expect(await heartbeat(db, first!, "dead-worker", 60)).toBe("lost");
    expect((await jobs())[0].status).toBe("running");
    expect(await completeJob(db, first!, "live-worker", {})).toBe(true);
  });

  it("doesn't claim a job that isn't due yet", async () => {
    await add();
    await db.update(productionJobs).set({ runAfter: new Date(Date.now() + 60_000) }).where(eq(productionJobs.workspaceId, workspaceId));
    expect(await claim("w")).toBeNull();
  });

  it("retries transient failures until the limit, then fails", async () => {
    await add("test.job", { maxAttempts: 2 });
    const failure = { code: "error", message: "boom", retryable: true, retryAfterSeconds: 0 };
    expect(await failJob(db, (await claim("w"))!, "w", failure)).toBe("retrying");
    expect(await failJob(db, (await claim("w"))!, "w", failure)).toBe("failed");
    expect((await jobs())[0]).toMatchObject({ status: "failed", errorMessage: "boom" });
  });

  it("doesn't retry permanent failures", async () => {
    await add();
    expect(await failJob(db, (await claim("w"))!, "w", { code: "permanent", message: "no", retryable: false })).toBe("failed");
  });

  it("honours a provider's Retry-After", async () => {
    await add();
    await failJob(db, (await claim("w"))!, "w", { code: "rate_limited", message: "slow", retryable: true, retryAfterSeconds: 300 });
    const [job] = await jobs();
    expect(job.runAfter.getTime()).toBeGreaterThan(Date.now() + 250_000);
  });

  it("holds a paused agent's jobs and runs them after resume", async () => {
    await add();
    await withUser(userId, (tx) => domain.setAgentPaused(tx, { userId, workspaceId }, "editing", true));
    expect(await claim("w")).toBeNull();
    await withUser(userId, (tx) => domain.setAgentPaused(tx, { userId, workspaceId }, "editing", false));
    expect(await claim("w")).not.toBeNull();
  });

  it("cancels queued jobs immediately and tells running jobs to stop", async () => {
    await add();
    const ctx = { userId, workspaceId };
    const [queued] = await jobs();
    await withUser(userId, (tx) => domain.cancelJob(tx, ctx, queued.id));
    expect((await jobs())[0].status).toBe("cancelled");

    await withUser(userId, (tx) => domain.retryJob(tx, ctx, queued.id));
    const running = await claim("w");
    await withUser(userId, (tx) => domain.cancelJob(tx, ctx, running!.id));
    expect((await jobs())[0].status).toBe("cancel_requested");
    expect(await heartbeat(db, running!, "w", 60)).toBe("cancelled");
  });

  it("won't let another workspace retry or cancel a job", async () => {
    await add();
    const [job] = await jobs();
    const outsider = { userId: otherUser, workspaceId: otherWorkspace };
    await expect(withUser(otherUser, (tx) => domain.cancelJob(tx, outsider, job.id))).rejects.toThrow("Job not found");
    await expect(withUser(otherUser, (tx) => domain.retryJob(tx, { userId: otherUser, workspaceId }, job.id))).rejects.toThrow("Job not found");
  });
});

describe("tenant isolation in the worker", () => {
  it("refuses to render an asset from another workspace, even if a timeline names it", async () => {
    const [foreign] = await db.insert(mediaAssets).values({ workspaceId: otherWorkspace, kind: "source_video", storageKey: `${otherWorkspace}/secret-${tag}.mp4` }).returning();
    const timeline = buildClipTimeline({
      sourceAssetId: foreign.id,
      start: 0,
      end: 3,
      words: [],
      template: getTemplate("signal"),
      brand: { brandPrimary: "#58D5C9", brandSecondary: "#77A9FF" },
    });
    const [video] = await db.insert(videoProjects).values({ workspaceId, projectId, mode: "clipper", status: "ready_to_render", title: "Stolen", timeline, timelineVersion: 1 }).returning();
    await withUser(userId, (tx) => domain.requestRender(tx, { userId, workspaceId }, video.id));

    await runJob((await claim("w"))!, "w");

    const [job] = await jobs();
    expect(job).toMatchObject({ status: "failed", errorCode: "assets_missing", attempts: 1 });
    const [after] = await db.select().from(videoProjects).where(eq(videoProjects.id, video.id));
    expect(after.status).toBe("failed");
  });
});

describe("rules that protect people from mistakes", () => {
  const ctx = () => ({ userId, workspaceId });

  it("defaults new projects to approval required, with no auto-publish", async () => {
    const { projectSettings } = await import("../src/db/schema");
    const [settings] = await withUser(userId, async (tx) => {
      const project = await domain.createProject(tx, ctx(), { name: `P${tag}`, niche: "x", mode: "faceless" });
      return tx.select().from(projectSettings).where(eq(projectSettings.projectId, project.id));
    });
    expect(settings).toMatchObject({ approvalRequired: true, autoPublish: false });
  });

  it("enforces the plan's project limit", async () => {
    await db.update(subscriptions).set({ plan: "starter" }).where(eq(subscriptions.workspaceId, workspaceId));
    await expect(withUser(userId, (tx) => domain.createProject(tx, ctx(), { name: "Over", niche: "x", mode: "faceless" }))).rejects.toThrow(/Starter plan includes 1/);
    await db.update(subscriptions).set({ plan: "pro" }).where(eq(subscriptions.workspaceId, workspaceId));
  });

  it("stops new AI work at the monthly budget, and storage at the plan limit", async () => {
    await db.update(subscriptions).set({ plan: "starter" }).where(eq(subscriptions.workspaceId, workspaceId));
    await expect(withUser(userId, (tx) => domain.assertAiBudget(tx, ctx()))).resolves.toBeUndefined();
    await db.insert(usageEvents).values({ workspaceId, kind: "llm", provider: "test", quantity: 1, unit: "tokens", costMicroUsd: 5_000_000 });
    await expect(withUser(userId, (tx) => domain.assertAiBudget(tx, ctx()))).rejects.toThrow(/\$5 AI budget/);
    await expect(withUser(userId, (tx) => domain.startDiscovery(tx, ctx(), { projectId, query: "x" }))).rejects.toThrow(/AI budget/);
    await db.delete(usageEvents).where(and(eq(usageEvents.workspaceId, workspaceId), eq(usageEvents.kind, "llm")));
    await expect(withUser(userId, (tx) => domain.assertStorageQuota(tx, ctx(), 6 * 1024 ** 3))).rejects.toThrow(/5 GB/);
    await expect(withUser(userId, (tx) => domain.assertStorageQuota(tx, ctx(), 1024))).resolves.toBeUndefined();
    await db.update(subscriptions).set({ plan: "pro" }).where(eq(subscriptions.workspaceId, workspaceId));
  });

  it("stops renders when the monthly quota is used up", async () => {
    await db.update(subscriptions).set({ plan: "starter" }).where(eq(subscriptions.workspaceId, workspaceId));
    await db.insert(usageEvents).values(Array.from({ length: 20 }, () => ({ workspaceId, kind: "render", provider: "remotion", quantity: 1, unit: "seconds" })));
    await expect(withUser(userId, (tx) => domain.assertRenderQuota(tx, ctx()))).rejects.toThrow(/used all 20 renders/);
    await db.delete(usageEvents).where(and(eq(usageEvents.workspaceId, workspaceId), eq(usageEvents.kind, "render")));
    await db.update(subscriptions).set({ plan: "pro" }).where(eq(subscriptions.workspaceId, workspaceId));
  });
});
