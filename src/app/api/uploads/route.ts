import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withUser } from "@/db/client";
import { mediaAssets } from "@/db/schema";
import { getSessionContext, jsonError } from "@/server/api";
import { assertStorageQuota, UserError } from "@/server/domain";
import { isUploadKind, uploadKey, validateUpload } from "@/server/uploads";
import { getStorage } from "@/services/registry";

const schema = z.object({
  projectId: z.string().uuid().nullable(),
  kind: z.string(),
  filename: z.string().min(1).max(255),
  contentType: z.string(),
  sizeBytes: z.number().int().positive(),
});

/** Step 1 of an upload: checks the declared file and returns where to send the bytes. */
export async function POST(request: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return jsonError("Sign in again to upload.", 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isUploadKind(parsed.data.kind)) return jsonError("This upload request isn't valid.", 400);
  const { projectId, kind, filename, contentType, sizeBytes } = parsed.data;

  try {
    validateUpload(kind, contentType, sizeBytes);
    const id = randomUUID();
    const storageKey = uploadKey(ctx.workspaceId, kind, id, filename);
    await withUser(ctx.userId, async (tx) => {
      await assertStorageQuota(tx, ctx, sizeBytes);
      await tx.insert(mediaAssets).values({
        id,
        workspaceId: ctx.workspaceId,
        projectId,
        kind,
        status: "pending_upload",
        storageKey,
        filename,
        contentType,
        sizeBytes,
      });
    });
    const target = await getStorage().uploadTarget(storageKey, contentType);
    return NextResponse.json({ id, target: target ?? { url: `/api/uploads/${id}/content`, method: "PUT", headers: { "Content-Type": contentType } } });
  } catch (error) {
    if (error instanceof UserError) return jsonError(error.message, 400);
    // Anything else, such as a viewer blocked by RLS, must not reach the browser as a raw SQL error.
    console.error(error);
    return jsonError("You can't upload to this workspace.", 403);
  }
}
