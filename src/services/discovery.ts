import { assertOk } from "./errors";
import type { ResearchProvider, StockClip, StockVideoProvider, YoutubeDiscoveryProvider, YoutubeVideo } from "./types";

/** "PT1H2M3S" to seconds. Null for live or unknown durations. */
export function parseIsoDuration(value: string | undefined): number | null {
  const match = value?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

function youtubeBase() {
  return (process.env.YOUTUBE_BASE_URL ?? "https://www.googleapis.com/youtube/v3").replace(/\/$/, "");
}

type VideoResource = {
  id: string;
  snippet: {
    title: string;
    channelTitle: string;
    channelId: string;
    description: string;
    publishedAt: string;
    defaultLanguage?: string;
    defaultAudioLanguage?: string;
    thumbnails?: Record<string, { url: string }>;
  };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
};

function toVideo(resource: VideoResource): YoutubeVideo {
  const thumbs = resource.snippet.thumbnails ?? {};
  const stat = (value?: string) => (value === undefined ? null : Number(value));
  return {
    youtubeId: resource.id,
    title: resource.snippet.title,
    channelTitle: resource.snippet.channelTitle,
    channelId: resource.snippet.channelId,
    description: resource.snippet.description,
    thumbnailUrl: (thumbs.high ?? thumbs.medium ?? thumbs.default)?.url ?? null,
    durationSeconds: parseIsoDuration(resource.contentDetails?.duration),
    publishedAt: resource.snippet.publishedAt ?? null,
    viewCount: stat(resource.statistics?.viewCount),
    likeCount: stat(resource.statistics?.likeCount),
    commentCount: stat(resource.statistics?.commentCount),
    language: resource.snippet.defaultAudioLanguage ?? resource.snippet.defaultLanguage ?? null,
  };
}

async function fetchVideos(ids: string[], signal?: AbortSignal): Promise<YoutubeVideo[]> {
  if (ids.length === 0) return [];
  const params = new URLSearchParams({
    part: "snippet,contentDetails,statistics",
    id: ids.join(","),
    key: process.env.YOUTUBE_API_KEY ?? "",
  });
  const response = await fetch(`${youtubeBase()}/videos?${params}`, { signal });
  await assertOk(response, "YouTube Data API");
  const body = (await response.json()) as { items: VideoResource[] };
  return body.items.map(toVideo);
}

/** Official YouTube Data API v3. Metadata only: this adapter never downloads media. */
export const youtubeDiscovery: YoutubeDiscoveryProvider = {
  name: "youtube-data-api",
  async search(search, options = {}) {
    const params = new URLSearchParams({
      part: "snippet",
      type: "video",
      order: search.channelId && !search.query ? "date" : "relevance",
      maxResults: String(search.maxResults ?? 15),
      key: process.env.YOUTUBE_API_KEY ?? "",
    });
    if (search.query) params.set("q", search.query);
    if (search.channelId) params.set("channelId", search.channelId);
    if (search.language) params.set("relevanceLanguage", search.language);
    if (search.regionCode) params.set("regionCode", search.regionCode);
    if (search.publishedAfter) params.set("publishedAfter", search.publishedAfter);
    if (search.duration && search.duration !== "any") params.set("videoDuration", search.duration);

    const response = await fetch(`${youtubeBase()}/search?${params}`, { signal: options.signal });
    await assertOk(response, "YouTube Data API");
    const body = (await response.json()) as { items: { id: { videoId?: string } }[] };
    const ids = body.items.map((item) => item.id.videoId).filter((id): id is string => Boolean(id));
    return fetchVideos(ids, options.signal);
  },
  async getVideo(youtubeId, options = {}) {
    return (await fetchVideos([youtubeId], options.signal))[0] ?? null;
  },
};

/** Parses a video id out of the usual YouTube URL shapes. */
export function parseYoutubeId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.hostname === "youtu.be") return url.pathname.slice(1, 12) || null;
    if (!url.hostname.endsWith("youtube.com")) return null;
    const fromQuery = url.searchParams.get("v");
    if (fromQuery) return fromQuery;
    return url.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{11})/)?.[1] ?? null;
  } catch {
    return null;
  }
}

type PexelsVideo = {
  id: number;
  url: string;
  duration: number;
  user?: { name?: string };
  video_files: { link: string; width: number | null; height: number | null; file_type: string }[];
};

/** Licensed stock footage under the Pexels License. */
export const pexelsStock: StockVideoProvider = {
  name: "pexels",
  async search(query, options = {}) {
    const base = (process.env.PEXELS_BASE_URL ?? "https://api.pexels.com").replace(/\/$/, "");
    const params = new URLSearchParams({ query, orientation: "portrait", size: "medium", per_page: String(options.perPage ?? 10) });
    const response = await fetch(`${base}/videos/search?${params}`, {
      signal: options.signal,
      headers: { Authorization: process.env.PEXELS_API_KEY ?? "" },
    });
    await assertOk(response, "Pexels");
    const body = (await response.json()) as { videos: PexelsVideo[] };
    options.onUsage?.({ kind: "stock", provider: "pexels", quantity: 1, unit: "searches", costMicroUsd: 0 });
    return body.videos.flatMap((video): StockClip[] => {
      const file = video.video_files
        .filter((f) => f.file_type === "video/mp4" && (f.width ?? 0) >= 540)
        .sort((a, b) => Math.abs((a.height ?? 0) - 1920) - Math.abs((b.height ?? 0) - 1920))[0];
      if (!file) return [];
      return [
        {
          provider: "pexels",
          externalId: String(video.id),
          downloadUrl: file.link,
          pageUrl: video.url,
          durationSeconds: video.duration,
          width: file.width ?? 0,
          height: file.height ?? 0,
          license: "Pexels License",
          attribution: video.user?.name ? `Video by ${video.user.name} on Pexels` : "Video from Pexels",
        },
      ];
    });
  },
};

type PixabayVideo = {
  id: number;
  pageURL: string;
  duration: number;
  user?: string;
  tags?: string;
  videos: Record<string, { url: string; width: number; height: number }>;
};

/** How many search words appear in a clip's tags. Pixabay can rank loose matches first. */
function tagMatches(query: string, tags = "") {
  const lower = tags.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word && lower.includes(word)).length;
}

const PIXABAY_CACHE_MS = 24 * 60 * 60 * 1000;
const pixabayCache = new Map<string, { at: number; hits: PixabayVideo[] }>();

/** Stock footage under the Pixabay Content License. Its API terms require caching searches for 24 hours. */
export const pixabayStock: StockVideoProvider = {
  name: "pixabay",
  async search(query, options = {}) {
    const base = (process.env.PIXABAY_BASE_URL ?? "https://pixabay.com").replace(/\/$/, "");
    const perPage = Math.max(options.perPage ?? 10, 3);
    const cacheKey = `${query}|${perPage}`;
    let hits = pixabayCache.get(cacheKey);
    if (!hits || Date.now() - hits.at > PIXABAY_CACHE_MS) {
      const params = new URLSearchParams({ key: process.env.PIXABAY_API_KEY ?? "", q: query.slice(0, 100), video_type: "film", safesearch: "true", per_page: String(perPage) });
      const response = await fetch(`${base}/api/videos/?${params}`, { signal: options.signal });
      await assertOk(response, "Pixabay");
      const body = (await response.json()) as { hits: PixabayVideo[] };
      options.onUsage?.({ kind: "stock", provider: "pixabay", quantity: 1, unit: "searches", costMicroUsd: 0 });
      hits = { at: Date.now(), hits: body.hits };
      pixabayCache.set(cacheKey, hits);
    }
    const ranked = [...hits.hits].sort((a, b) => tagMatches(query, b.tags) - tagMatches(query, a.tags));
    const clips = ranked.flatMap((video): StockClip[] => {
      const files = Object.values(video.videos).filter((f) => f.url && f.width >= 540);
      // The smallest file that's still 1080 tall. 4K footage makes renders many times slower.
      const file = files.filter((f) => f.height >= 1080).sort((a, b) => a.height - b.height)[0] ?? files.sort((a, b) => b.height - a.height)[0];
      if (!file) return [];
      return [
        {
          provider: "pixabay",
          externalId: String(video.id),
          downloadUrl: file.url,
          pageUrl: video.pageURL,
          durationSeconds: video.duration,
          width: file.width,
          height: file.height,
          license: "Pixabay Content License",
          attribution: video.user ? `Video by ${video.user} on Pixabay` : "Video from Pixabay",
        },
      ];
    });
    return clips;
  },
};

/** Wikipedia's public API: real, citable source text with no key required. */
export const wikipediaResearch: ResearchProvider = {
  name: "wikipedia",
  async search(topic, options = {}) {
    const language = options.language ?? "en";
    const base = (process.env.WIKIPEDIA_BASE_URL ?? `https://${language}.wikipedia.org`).replace(/\/$/, "");
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      generator: "search",
      gsrsearch: topic,
      gsrlimit: String(options.limit ?? 4),
      prop: "extracts|info",
      inprop: "url",
      exintro: "1",
      explaintext: "1",
      exlimit: "max",
    });
    const response = await fetch(`${base}/w/api.php?${params}`, {
      signal: options.signal,
      headers: { "User-Agent": "VideoAutomation/0.1 (research adapter)" },
    });
    await assertOk(response, "Wikipedia");
    const body = (await response.json()) as {
      query?: { pages?: Record<string, { title: string; extract?: string; fullurl?: string; index?: number }> };
    };
    return Object.values(body.query?.pages ?? {})
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .filter((page) => page.extract && page.fullurl)
      .map((page) => ({ title: page.title, url: page.fullurl!, excerpt: page.extract!.slice(0, 1800), provider: "wikipedia" }));
  },
};
