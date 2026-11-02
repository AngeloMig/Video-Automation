import { and, eq } from "drizzle-orm";
import { serviceDb } from "../db/client";
import { mediaAssets } from "../db/schema";
import { probeMedia } from "../media/ffmpeg";
import { getStorage } from "../services/registry";
import { UserError, type RequestContext } from "./domain";

export const UPLOAD_RULES = {
  source_video: { maxBytes: 5 * 1024 ** 3, types: ["video/mp4", "video/quicktime", "video/webm"] },
  broll_video: { maxBytes: 1024 ** 3, types: ["video/mp4", "video/quicktime", "video/webm"] },
  broll_image: { maxBytes: 25 * 1024 ** 2, types: ["image/png", "image/jpeg", "image/webp"] },
  logo: { maxBytes: 5 * 1024 ** 2, types: ["image/png", "image/jpeg", "image/webp"] },
  music: { maxBytes: 100 * 1024 ** 2, types: ["audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav"] },
} as const;

export type UploadKind = keyof typeof UPLOAD_RULES;

export function isUploadKind(value: string): value is UploadKind {
  return value in UPLOAD_RULES;
}

export function validateUpload(kind: UploadKind, contentType: string, sizeBytes: number) {
  const rule = UPLOAD_RULES[kind];
  if (!(rule.types as readonly string[]).includes(contentType)) {
    throw new UserError(`This file type isn't supported. Use ${rule.types.map((type) => type.split("/")[1]).join(", ")}.`);
  }
  if (sizeBytes > rule.maxBytes) throw new UserError(`This file is over the ${Math.round(rule.maxBytes / 1024 ** 2)} MB limit.`);
}

function storageExtension(filename: string) {
  return (filename.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
}

export function uploadKey(workspaceId: string, kind: UploadKind, assetId: string, filename: string) {
  return `${workspaceId}/uploads/${kind}/${assetId}.${storageExtension(filename)}`;
}

/**
 * Inspects the stored bytes with ffprobe, so a renamed file can't pass as video and the recorded
 * duration is the real one. Files that aren't valid media are deleted from storage.
 */
export async function probeUploadedFile(kind: UploadKind, storageKey: string) {
  const storage = getStorage();
  const url = await storage.readUrl(storageKey);
  if (kind === "broll_image" || kind === "logo") return { durationSeconds: null, width: null, height: null };
  try {
    const probe = await probeMedia(url);
    if (kind === "music" ? !probe.hasAudio : !probe.hasVideo) throw new Error("wrong stream type");
    if (probe.durationSeconds <= 0) throw new Error("no duration");
    return { durationSeconds: probe.durationSeconds, width: probe.width, height: probe.height };
  } catch {
    await storage.remove(storageKey).catch(() => {});
    throw new UserError("This file couldn't be read as valid media. Check that it plays, then upload it again.");
  }
}

/** Creates the ready asset row for a file already in storage. Used by the test harness. */
export async function registerUploadedFile(
  ctx: RequestContext,
  input: { projectId: string; kind: UploadKind; storageKey: string; filename: string; contentType: string },
) {
  const probe = await probeUploadedFile(input.kind, input.storageKey);
  const [asset] = await serviceDb()
    .insert(mediaAssets)
    .values({
      workspaceId: ctx.workspaceId,
      projectId: input.projectId,
      kind: input.kind,
      status: "ready",
      storageKey: input.storageKey,
      filename: input.filename,
      contentType: input.contentType,
      durationSeconds: probe.durationSeconds,
      width: probe.width,
      height: probe.height,
    })
    .returning();
  const [row] = await serviceDb().select().from(mediaAssets).where(and(eq(mediaAssets.id, asset.id), eq(mediaAssets.workspaceId, ctx.workspaceId)));
  return row;
}
