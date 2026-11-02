import { createReadStream, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * TEST ONLY. A local stand-in that speaks the OpenAI, ElevenLabs, Pexels and YouTube wire formats,
 * so tests exercise the real adapters and pipelines. Nothing it returns is AI output. It never
 * runs outside tests, and passing tests here says nothing about a real provider accepting our
 * requests.
 */
export type FakeProviderOptions = {
  /** Local MP3 returned by the speech endpoints. */
  speechMp3Path: string;
  /** Local MP4 returned as stock footage. */
  stockMp4Path: string;
  transcriptWords: { word: string; start: number; end: number }[];
  transcriptSegments: { start: number; end: number; text: string }[];
};

export type FakeProviders = { server: Server; baseUrl: string; requests: string[]; failNext: (path: string, status: number) => void; close: () => Promise<void> };

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function startFakeProviders(options: FakeProviderOptions): Promise<FakeProviders> {
  const requests: string[] = [];
  const failures = new Map<string, number>();

  const chat = (messages: { role: string; content: string }[]) => {
    const system = messages[0].content;
    const user = JSON.parse(messages[1].content);
    if (system.includes("extract facts")) {
      return {
        angle: "Why the topic matters",
        facts: [
          { claim: "A source-backed claim about the topic.", sourceIds: [user.sources[0].id] },
          { claim: "An unsupported aside.", sourceIds: [] },
          { claim: "A claim citing a source that doesn't exist.", sourceIds: ["s99"] },
        ],
      };
    }
    if (system.includes("write original narration")) {
      return {
        title: "The test video title",
        hook: "A hook on screen",
        callToAction: "Follow for more.",
        scenes: [
          { narration: "First scene explains the idea in plain words.", visualQuery: "city skyline" },
          { narration: "Second scene adds a supporting detail for viewers.", visualQuery: "ocean waves" },
        ],
      };
    }
    if (system.includes("pick self-contained moments")) {
      return {
        clips: [
          { start: 0.2, end: 6.1, title: "The opening claim", hook: "Listen to this", score: 88, reason: "Strong opening." },
          { start: 1, end: 5, title: "Overlapping, lower score", hook: "Dropped", score: 40, reason: "Overlaps the first." },
          { start: 6.3, end: 11.9, title: "The explanation", hook: "Here is why", score: 72, reason: "Clear explanation." },
        ],
      };
    }
    if (system.includes("assess YouTube videos")) {
      return {
        videos: user.videos.map((video: { id: string }) => ({
          id: video.id,
          relevance: 80,
          hook: 70,
          educational: 60,
          storytelling: 50,
          shortForm: 75,
          reason: "Fits the niche.",
          tags: ["test"],
          suggestedMode: "faceless",
        })),
      };
    }
    throw new Error(`Unexpected prompt: ${system.slice(0, 60)}`);
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    requests.push(`${request.method} ${url.pathname}`);
    const json = (body: unknown, status = 200) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body));
    };
    const failStatus = failures.get(url.pathname);
    if (failStatus) {
      failures.delete(url.pathname);
      await readBody(request);
      return json({ error: "injected failure" }, failStatus);
    }
    const sendFile = (path: string, type: string) => {
      response.writeHead(200, { "Content-Type": type, "Content-Length": statSync(path).size });
      createReadStream(path).pipe(response);
    };

    if (url.pathname === "/v1/chat/completions") {
      const body = JSON.parse(await readBody(request));
      const content = JSON.stringify(chat(body.messages));
      return json({ choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
    }
    if (url.pathname === "/v1/audio/transcriptions") {
      await readBody(request);
      return json({ text: options.transcriptWords.map((w) => w.word).join(" "), language: "en", duration: 12, words: options.transcriptWords, segments: options.transcriptSegments });
    }
    if (url.pathname === "/v1/audio/speech") {
      await readBody(request);
      return sendFile(options.speechMp3Path, "audio/mpeg");
    }
    if (url.pathname === "/videos/search") {
      const query = url.searchParams.get("query") ?? "";
      return json({
        videos: [1, 2, 3].map((n) => ({
          id: query.length * 100 + n,
          url: `https://pexels.test/video/${n}`,
          duration: 3,
          user: { name: "Test Filmer" },
          video_files: [{ link: `http://localhost:${(server.address() as AddressInfo).port}/stock.mp4`, width: 1080, height: 1920, file_type: "video/mp4" }],
        })),
      });
    }
    if (url.pathname === "/stock.mp4") return sendFile(options.stockMp4Path, "video/mp4");
    if (url.pathname === "/yt/search") {
      return json({ items: [{ id: { videoId: "aaaaaaaaaaa" } }, { id: { videoId: "bbbbbbbbbbb" } }, { id: { videoId: "ccccccccccc" } }] });
    }
    if (url.pathname === "/yt/videos") {
      const ids = (url.searchParams.get("id") ?? "").split(",");
      return json({
        items: ids.map((id) => ({
          id,
          snippet: {
            title: id === "ccccccccccc" ? "Sponsored gambling tips" : `Video ${id}`,
            channelTitle: "Test Channel",
            channelId: "chan",
            description: "A description",
            publishedAt: new Date(Date.now() - 86_400_000).toISOString(),
            thumbnails: { high: { url: "https://img.test/t.jpg" } },
          },
          contentDetails: { duration: "PT12M30S" },
          statistics: id === "aaaaaaaaaaa" ? { viewCount: "1000", likeCount: "50", commentCount: "5" } : { viewCount: "500" },
        })),
      });
    }
    json({ error: `no route ${url.pathname}` }, 404);
  });

  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    failNext: (path, status) => failures.set(path, status),
    close: () => new Promise((done) => server.close(() => done())),
  };
}
