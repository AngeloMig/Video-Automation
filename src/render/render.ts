import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, makeCancelSignal, renderMedia, selectComposition } from "@remotion/renderer";
import { localPathFor } from "../services/storage";
import type { StorageProvider } from "../services/types";
import type { TimelineProps, TimelineSpec } from "../timeline/spec";

let bundlePromise: Promise<string> | null = null;

function getBundle() {
  bundlePromise ??= bundle({ entryPoint: resolve("src/remotion/index.tsx") }).catch((error) => {
    bundlePromise = null;
    throw error;
  });
  return bundlePromise;
}

const CONTENT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/**
 * Chrome can't read file:// media in the renderer, so local storage is served over loopback with
 * Range support for the length of one render, under a random path segment.
 */
async function startLocalAssetServer(): Promise<{ server: Server; urlFor: (key: string) => string }> {
  const token = randomUUID();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const prefix = `/${token}/`;
      if (!url.pathname.startsWith(prefix)) {
        response.writeHead(404).end();
        return;
      }
      const path = localPathFor(decodeURIComponent(url.pathname.slice(prefix.length)));
      const { size } = await stat(path);
      const extension = path.split(".").pop()?.toLowerCase() ?? "";
      const headers: Record<string, string | number> = {
        "Accept-Ranges": "bytes",
        "Content-Type": CONTENT_TYPES[extension] ?? "application/octet-stream",
        "Access-Control-Allow-Origin": "*",
      };
      const range = request.headers.range?.match(/bytes=(\d*)-(\d*)/);
      if (range) {
        const start = range[1] ? Number(range[1]) : size - Number(range[2]);
        const end = range[1] && range[2] ? Number(range[2]) : size - 1;
        response.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
        createReadStream(path, { start, end }).pipe(response);
        return;
      }
      response.writeHead(200, { ...headers, "Content-Length": size });
      createReadStream(path).pipe(response);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return { server, urlFor: (key) => `http://127.0.0.1:${port}/${token}/${key.split("/").map(encodeURIComponent).join("/")}` };
}

export type RenderRequest = {
  spec: TimelineSpec;
  /** Asset id to storage key, for every asset the spec draws. */
  assetKeys: Record<string, string>;
  storage: StorageProvider;
  outputPath: string;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
};

export async function renderTimeline(request: RenderRequest): Promise<{ renderMs: number }> {
  const started = Date.now();
  const local = request.storage.name === "local" ? await startLocalAssetServer() : null;
  try {
    const assetUrls: Record<string, string> = {};
    for (const [assetId, key] of Object.entries(request.assetKeys)) {
      assetUrls[assetId] = local ? local.urlFor(key) : await request.storage.readUrl(key, 6 * 3600);
    }
    const inputProps: TimelineProps = { spec: request.spec, assetUrls };

    await ensureBrowser();
    const serveUrl = await getBundle();
    const composition = await selectComposition({ serveUrl, id: "Timeline", inputProps });

    const { cancelSignal, cancel } = makeCancelSignal();
    request.signal?.addEventListener("abort", () => cancel(), { once: true });

    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      audioCodec: "aac",
      crf: 20,
      inputProps,
      outputLocation: request.outputPath,
      // Keeps one consistent output format even for a timeline with no audio clips.
      enforceAudioTrack: true,
      cancelSignal,
      concurrency: process.env.RENDER_CONCURRENCY ? Number(process.env.RENDER_CONCURRENCY) : null,
      onProgress: ({ progress }) => request.onProgress?.(progress),
    });
    return { renderMs: Date.now() - started };
  } finally {
    local?.server.close();
  }
}
