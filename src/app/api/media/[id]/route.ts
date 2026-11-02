import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { withUser } from "@/db/client";
import { mediaAssets } from "@/db/schema";
import { getSessionContext, isUuid, jsonError } from "@/server/api";
import { getStorage } from "@/services/registry";
import { localPathFor } from "@/services/storage";

/**
 * Serves media to workspace members. RLS decides access, and a file outside the workspace is a
 * plain 404. S3 and R2 redirect to a short-lived signed URL. Local files stream with Range support,
 * which the Player needs to seek.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx) return jsonError("Sign in to view this.", 401);
  const { id } = await params;
  if (!isUuid(id)) return jsonError("Not found", 404);
  const [asset] = await withUser(ctx.userId, (tx) =>
    tx.select().from(mediaAssets).where(and(eq(mediaAssets.id, id), eq(mediaAssets.workspaceId, ctx.workspaceId))),
  );
  if (!asset) return jsonError("Not found", 404);

  const url = new URL(request.url);
  const isThumbnail = url.searchParams.get("variant") === "thumbnail";
  const thumbnailKey = asset.metadata.thumbnailKey as string | undefined;
  if (isThumbnail && !thumbnailKey) return jsonError("Not found", 404);
  const key = isThumbnail ? thumbnailKey! : asset.storageKey;
  const contentType = isThumbnail ? "image/jpeg" : (asset.contentType ?? "application/octet-stream");
  const download = url.searchParams.get("download") === "1";

  const storage = getStorage();
  if (storage.name !== "local") return NextResponse.redirect(await storage.readUrl(key, 900));

  const path = localPathFor(key);
  const { size } = await stat(path).catch(() => ({ size: -1 }));
  if (size < 0) return jsonError("Not found", 404);
  const headers: Record<string, string> = {
    "Accept-Ranges": "bytes",
    "Content-Type": contentType,
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  };
  if (download) {
    const name = (asset.filename ?? "video.mp4").replace(/[^\w. -]+/g, "");
    headers["Content-Disposition"] = `attachment; filename="${name}"`;
  }

  const range = request.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(size - Number(range[2]), 0);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    return new Response(Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, { headers: { ...headers, "Content-Length": String(size) } });
}
