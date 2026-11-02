import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withUser } from "@/db/client";
import { mediaAssets } from "@/db/schema";
import { getSessionContext, isUuid, jsonError } from "@/server/api";
import { registerSource, UserError } from "@/server/domain";
import { isUploadKind, probeUploadedFile } from "@/server/uploads";
import { getStorage } from "@/services/registry";

const schema = z.object({
  source: z
    .object({
      projectId: z.string().uuid(),
      title: z.string().trim().min(1).max(200),
      rightsBasis: z.enum(["i_created_it", "i_have_a_license", "public_domain"]),
      rightsConfirmed: z.boolean(),
    })
    .optional(),
});

/** Step 3 of an upload: validates the stored bytes, then makes the asset usable. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx) return jsonError("Sign in again to upload.", 401);
  const { id } = await params;
  if (!isUuid(id)) return jsonError("Upload not found.", 404);
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError("This upload request isn't valid.", 400);

  const [asset] = await withUser(ctx.userId, (tx) =>
    tx.select().from(mediaAssets).where(and(eq(mediaAssets.id, id), eq(mediaAssets.workspaceId, ctx.workspaceId), eq(mediaAssets.status, "pending_upload"))),
  );
  if (!asset || !isUploadKind(asset.kind)) return jsonError("Upload not found.", 404);
  if (asset.kind === "source_video" && parsed.data.source?.rightsConfirmed !== true) {
    await getStorage().remove(asset.storageKey).catch(() => {});
    return jsonError("Confirm that you have the rights to this footage.", 400);
  }
  if (!(await getStorage().exists(asset.storageKey))) return jsonError("The file didn't reach storage. Upload it again.", 400);

  try {
    const probe = await probeUploadedFile(asset.kind, asset.storageKey);
    const sourceId = await withUser(ctx.userId, async (tx) => {
      await tx
        .update(mediaAssets)
        .set({ status: "ready", durationSeconds: probe.durationSeconds, width: probe.width, height: probe.height })
        .where(eq(mediaAssets.id, id));
      if (!parsed.data.source) return null;
      const source = await registerSource(tx, ctx, {
        projectId: parsed.data.source.projectId,
        mediaAssetId: id,
        title: parsed.data.source.title,
        rightsBasis: parsed.data.source.rightsBasis,
        rightsConfirmed: true,
      });
      return source.id;
    });
    return NextResponse.json({ id, sourceId, durationSeconds: probe.durationSeconds });
  } catch (error) {
    await withUser(ctx.userId, (tx) => tx.update(mediaAssets).set({ status: "rejected" }).where(eq(mediaAssets.id, id)));
    return jsonError(error instanceof UserError ? error.message : "Upload failed.", 400);
  }
}
