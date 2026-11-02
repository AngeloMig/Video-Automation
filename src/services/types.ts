import type { z } from "zod";

/** Reported by adapters. Costs are estimates from public list prices, or null when unknown. */
export type UsageRecord = {
  kind: "llm" | "transcription" | "tts" | "stock" | "render" | "storage";
  provider: string;
  quantity: number;
  unit: string;
  costMicroUsd: number | null;
};

export type CallOptions = { signal?: AbortSignal; onUsage?: (usage: UsageRecord) => void };

export interface LlmProvider {
  readonly name: string;
  generateJson<T>(
    request: { system: string; user: string; schema: z.ZodType<T>; temperature?: number },
    options?: CallOptions,
  ): Promise<T>;
}

export type TranscriptionResult = {
  text: string;
  language?: string;
  words: { word: string; start: number; end: number }[];
  segments: { start: number; end: number; text: string; speaker?: string }[];
};

export interface SpeechToTextProvider {
  readonly name: string;
  transcribe(audioPath: string, options?: CallOptions & { language?: string }): Promise<TranscriptionResult>;
}

export type SpeechResult = {
  /** Encoded audio written to the output path given by the caller. */
  format: "mp3" | "wav" | "aiff";
  /** Provider-reported timings. Null when the provider has none and they must be estimated. */
  words: { word: string; start: number; end: number }[] | null;
};

export type VoiceOption = { id: string; label: string };

export interface TextToSpeechProvider {
  readonly name: string;
  /** Local system voices are real speech but dev-only, so production settings can exclude them. */
  readonly isSynthetic: boolean;
  listVoices(): Promise<VoiceOption[]>;
  synthesize(
    request: { text: string; voiceId?: string | null; speed?: number; outputPathWithoutExt: string; language?: string },
    options?: CallOptions,
  ): Promise<SpeechResult & { path: string }>;
}

export type StockClip = {
  provider: string;
  externalId: string;
  downloadUrl: string;
  pageUrl: string;
  durationSeconds: number;
  width: number;
  height: number;
  license: string;
  attribution: string;
};

export interface StockVideoProvider {
  readonly name: string;
  search(query: string, options?: CallOptions & { perPage?: number }): Promise<StockClip[]>;
}

export type YoutubeVideo = {
  youtubeId: string;
  title: string;
  channelTitle: string;
  channelId: string;
  description: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  publishedAt: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  language: string | null;
};

export type YoutubeSearch = {
  query?: string;
  channelId?: string;
  language?: string;
  regionCode?: string;
  publishedAfter?: string;
  duration?: "any" | "short" | "medium" | "long";
  maxResults?: number;
};

export interface YoutubeDiscoveryProvider {
  readonly name: string;
  search(search: YoutubeSearch, options?: CallOptions): Promise<YoutubeVideo[]>;
  getVideo(youtubeId: string, options?: CallOptions): Promise<YoutubeVideo | null>;
}

export type ResearchDocument = { title: string; url: string; excerpt: string; provider: string };

export interface ResearchProvider {
  readonly name: string;
  search(topic: string, options?: CallOptions & { language?: string; limit?: number }): Promise<ResearchDocument[]>;
}

export type StorageUploadTarget = { url: string; method: "PUT"; headers: Record<string, string> };

export interface StorageProvider {
  readonly name: string;
  putFile(key: string, localPath: string, contentType: string): Promise<{ sizeBytes: number }>;
  downloadTo(key: string, localPath: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
  /** URL any process (ffprobe, the renderer) can read for a limited time. */
  readUrl(key: string, expiresInSeconds?: number): Promise<string>;
  /** Browser upload target. Returns null when uploads must go through the app's own route. */
  uploadTarget(key: string, contentType: string): Promise<StorageUploadTarget | null>;
}

/** Phase 2 extension point. Implementations must only report "published" after provider confirmation. */
export interface SocialPublisher {
  readonly platform: "instagram" | "facebook" | "youtube";
  publish(
    request: { videoUrl: string; caption: string; idempotencyKey: string; accessToken: string; accountId: string },
    options?: CallOptions,
  ): Promise<{ externalPostId: string; externalUrl: string | null; confirmed: boolean }>;
}
