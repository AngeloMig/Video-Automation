"use server";

import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { projectSettings, videoProjects, workspaces } from "@/db/schema";
import type { AgentName } from "@/jobs/queue";
import { signIn, signOut, signUp } from "@/lib/auth";
import { parseYoutubeId } from "@/services/discovery";
import { getTts } from "@/services/registry";
import { type ActionResult, runAction } from "./context";
import * as domain from "./domain";

function done<T>(result: ActionResult<T>) {
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function loginAction(_: unknown, form: FormData) {
  const result = await signIn(String(form.get("email") ?? "").trim().toLowerCase(), String(form.get("password") ?? ""));
  if (result.error) return { error: result.error };
  redirect("/overview");
}

export async function signupAction(_: unknown, form: FormData) {
  const password = String(form.get("password") ?? "");
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!email.includes("@")) return { error: "Enter a valid email address." };
  if (password.length < 8) return { error: "Use a password with at least 8 characters." };
  const result = await signUp(email, password);
  if (result.error) return { error: result.error };
  if (result.needsConfirmation) return { notice: "Check your email to confirm your account, then sign in." };
  redirect("/projects/new");
}

export async function logoutAction() {
  await signOut();
  redirect("/login");
}

export const createProjectAction = async (input: domain.ProjectInput) =>
  done(await runAction((tx, ctx) => domain.createProject(tx, ctx, input).then((project) => project.id)));

export const updateProjectAction = async (id: string, input: domain.ProjectInput) =>
  done(await runAction((tx, ctx) => domain.updateProject(tx, ctx, id, input).then(() => undefined)));

export const archiveProjectAction = async (id: string) => done(await runAction((tx, ctx) => domain.archiveProject(tx, ctx, id)));

export const setProjectAssetAction = async (projectId: string, field: "logoAssetId" | "musicAssetId", assetId: string | null) =>
  done(
    await runAction(async (tx, ctx) => {
      await tx
        .update(projectSettings)
        .set({ [field]: assetId })
        .where(and(eq(projectSettings.projectId, projectId), eq(projectSettings.workspaceId, ctx.workspaceId)));
    }),
  );

export const setVoiceAction = async (projectId: string, voiceId: string | null, voiceSpeed: number) =>
  done(
    await runAction(async (tx, ctx) => {
      await tx
        .update(projectSettings)
        .set({ voiceId, voiceSpeed: Math.min(Math.max(voiceSpeed, 0.5), 2) })
        .where(and(eq(projectSettings.projectId, projectId), eq(projectSettings.workspaceId, ctx.workspaceId)));
    }),
  );

export async function listVoicesAction() {
  try {
    return { ok: true as const, voices: await getTts().listVoices() };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Couldn't load voices." };
  }
}

export const startDiscoveryAction = async (input: { projectId: string; query?: string; url?: string; publishedAfterDays?: number; duration?: "any" | "short" | "medium" | "long" }) =>
  done(
    await runAction((tx, ctx) => {
      let youtubeId: string | undefined;
      if (input.url) {
        const parsed = parseYoutubeId(input.url);
        if (!parsed) throw new domain.UserError("That doesn't look like a YouTube link.");
        youtubeId = parsed;
      }
      return domain.startDiscovery(tx, ctx, { projectId: input.projectId, query: youtubeId ? undefined : input.query || undefined, youtubeId, publishedAfterDays: input.publishedAfterDays, duration: input.duration });
    }),
  );

export const setDiscoveredStatusAction = async (id: string, status: "saved" | "dismissed" | "new") =>
  done(await runAction((tx, ctx) => domain.setDiscoveredStatus(tx, ctx, id, status)));

export const createFacelessAction = async (input: Parameters<typeof domain.createFacelessVideo>[2]) =>
  done(await runAction((tx, ctx) => domain.createFacelessVideo(tx, ctx, input).then((video) => video.id)));

export const regenerateSceneAction = async (input: Parameters<typeof domain.regenerateScene>[2]) =>
  done(await runAction((tx, ctx) => domain.regenerateScene(tx, ctx, input)));

export const startClipAnalysisAction = async (input: Parameters<typeof domain.startClipAnalysis>[2]) =>
  done(await runAction((tx, ctx) => domain.startClipAnalysis(tx, ctx, input)));

export const createManualClipAction = async (input: Parameters<typeof domain.createManualClip>[2]) =>
  done(await runAction((tx, ctx) => domain.createManualClip(tx, ctx, input).then((video) => video.id)));

export const requestRenderAction = async (id: string) => done(await runAction((tx, ctx) => domain.requestRender(tx, ctx, id)));

export const setApprovalAction = async (id: string, decision: "approved" | "rejected") =>
  done(await runAction((tx, ctx) => domain.setVideoApproval(tx, ctx, id, decision)));

export const deleteVideoAction = async (id: string) => done(await runAction((tx, ctx) => domain.deleteVideo(tx, ctx, id)));

export const updateClipDetailsAction = async (id: string, title: string) =>
  done(
    await runAction(async (tx, ctx) => {
      if (!title.trim()) throw new domain.UserError("Enter a title.");
      await tx.update(videoProjects).set({ title: title.trim() }).where(and(eq(videoProjects.id, id), eq(videoProjects.workspaceId, ctx.workspaceId)));
    }),
  );

export const saveTimelineAction = async (id: string, spec: unknown, note?: string) =>
  done(await runAction((tx, ctx) => domain.saveTimeline(tx, ctx, id, spec, note)));

export const restoreVersionAction = async (id: string, version: number) =>
  done(await runAction((tx, ctx) => domain.restoreTimelineVersion(tx, ctx, id, version)));

export const retryJobAction = async (id: string) => done(await runAction((tx, ctx) => domain.retryJob(tx, ctx, id)));
export const cancelJobAction = async (id: string) => done(await runAction((tx, ctx) => domain.cancelJob(tx, ctx, id)));
export const setAgentPausedAction = async (agent: AgentName, paused: boolean) =>
  done(await runAction((tx, ctx) => domain.setAgentPaused(tx, ctx, agent, paused)));

export const renameWorkspaceAction = async (name: string) =>
  done(
    await runAction(async (tx, ctx) => {
      if (!name.trim()) throw new domain.UserError("Enter a workspace name.");
      const rows = await tx.update(workspaces).set({ name: name.trim() }).where(eq(workspaces.id, ctx.workspaceId)).returning({ id: workspaces.id });
      if (rows.length === 0) throw new domain.UserError("Only owners and admins can rename the workspace.");
    }),
  );
