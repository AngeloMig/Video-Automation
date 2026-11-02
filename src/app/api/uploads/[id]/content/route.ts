import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { withUser } from "@/db/client";
import { mediaAssets } from "@/db/schema";
import { getSessionContext, isUuid, jsonError } from "@/server/api";
import { isUploadKind, UPLOAD_RULES } from "@/server/uploads";
import { getStorage } from "@/services/registry";
import { localPathFor } from "@/services/storage";

/** Local-storage uploads only. With S3 or R2 the browser uploads straight to the bucket. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx) return jsonError("Sign in again to upload.", 401);
  if (getStorage().name !== "local") return jsonError("Uploads go directly to object storage.", 400);
  const { id } = await params;
  if (!isUuid(id)) return jsonError("Upload not found.", 404);
  const [asset] = await withUser(ctx.userId, (tx) =>
    tx.select().from(mediaAssets).where(and(eq(mediaAssets.id, id), eq(mediaAssets.workspaceId, ctx.workspaceId), eq(mediaAssets.status, "pending_upload"))),
  );
  if (!asset || !request.body || !isUploadKind(asset.kind)) return jsonError("Upload not found.", 404);

  // The declared size was checked earlier, but the stream enforces the limit on the real bytes.
  const limit = UPLOAD_RULES[asset.kind].maxBytes;
  let received = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      received += chunk.length;
      done(received > limit ? new Error("too large") : null, chunk);
    },
  });
  const path = localPathFor(asset.storageKey);
  await mkdir(dirname(path), { recursive: true });
  try {
    await pipeline(Readable.fromWeb(request.body as never), meter, createWriteStream(path));
  } catch {
    await rm(path, { force: true });
    return jsonError("The upload stopped before it finished, or the file is over the limit.", 400);
  }
  return NextResponse.json({ ok: true });
}
