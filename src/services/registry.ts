import { IntegrationMissingError } from "./errors";
import { pexelsStock, pixabayStock, wikipediaResearch, youtubeDiscovery } from "./discovery";
import { openAiLlm, openAiStt, openAiTts } from "./openai";
import { localStorage, s3Storage } from "./storage";
import { elevenLabsTts, kokoroTts, systemTts } from "./tts";
import type {
  LlmProvider,
  ResearchProvider,
  SpeechToTextProvider,
  StockVideoProvider,
  StorageProvider,
  TextToSpeechProvider,
  YoutubeDiscoveryProvider,
} from "./types";

const has = (name: string) => Boolean(process.env[name]);

/** Pipelines depend on these getters only, so a provider can be swapped here. */
export function hasLlm() {
  return has("OPENAI_API_KEY");
}
export function getLlm(): LlmProvider {
  if (!hasLlm()) throw new IntegrationMissingError("OpenAI", ["OPENAI_API_KEY"]);
  return openAiLlm;
}

export function getStt(): SpeechToTextProvider {
  if (!has("OPENAI_API_KEY")) throw new IntegrationMissingError("Speech-to-text", ["OPENAI_API_KEY"]);
  return openAiStt;
}

/** Kokoro needs no key, so a voice is always available. `say` is only used when asked for by name. */
export function selectedTtsName(): "elevenlabs" | "openai" | "kokoro" | "macos-say" {
  const explicit = process.env.TTS_PROVIDER;
  if (explicit === "elevenlabs" || explicit === "openai" || explicit === "kokoro") return explicit;
  // `say` is a development convenience, because Apple's license limits it to non-commercial use.
  if (explicit === "macos-say" && process.platform === "darwin" && process.env.NODE_ENV !== "production") return explicit;
  if (has("ELEVENLABS_API_KEY")) return "elevenlabs";
  if (has("OPENAI_API_KEY")) return "openai";
  return "kokoro";
}
export function getTts(): TextToSpeechProvider {
  const name = selectedTtsName();
  if (name === "elevenlabs") return elevenLabsTts;
  if (name === "openai") return openAiTts;
  if (name === "macos-say") return systemTts;
  return kokoroTts;
}

/** Returns null when unconfigured: scenes then use typographic cards rather than unlicensed footage. */
export function getStock(): StockVideoProvider | null {
  if (has("PEXELS_API_KEY")) return pexelsStock;
  return has("PIXABAY_API_KEY") ? pixabayStock : null;
}

export function hasYoutube() {
  return has("YOUTUBE_API_KEY");
}
export function getYoutube(): YoutubeDiscoveryProvider {
  if (!hasYoutube()) throw new IntegrationMissingError("YouTube Data API", ["YOUTUBE_API_KEY"]);
  return youtubeDiscovery;
}

export function getResearch(): ResearchProvider {
  return wikipediaResearch;
}

export function hasS3() {
  return has("S3_BUCKET") && has("S3_ACCESS_KEY_ID") && has("S3_SECRET_ACCESS_KEY");
}
export function getStorage(): StorageProvider {
  if (hasS3()) return s3Storage;
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_LOCAL_STORAGE !== "true") {
    throw new IntegrationMissingError("Object storage", ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]);
  }
  return localStorage;
}

export type IntegrationState = "connected" | "local" | "not_configured" | "planned";

export type IntegrationStatus = {
  key: string;
  name: string;
  purpose: string;
  state: IntegrationState;
  detail: string;
  envVars: string[];
  docsUrl?: string;
};

/** Reports names and booleans only. Never put secret values in this result. */
export function integrationStatuses(): IntegrationStatus[] {
  const tts = selectedTtsName();
  const usingSupabase = has("NEXT_PUBLIC_SUPABASE_URL") && has("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return [
    {
      key: "auth",
      name: "Supabase Auth",
      purpose: "Sign-in for your team",
      state: usingSupabase ? "connected" : "local",
      detail: usingSupabase ? "Signing in through your Supabase project." : "Using development sign-in. Production requires Supabase.",
      envVars: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
      docsUrl: "https://supabase.com/dashboard/project/_/settings/api",
    },
    {
      key: "storage",
      name: "Cloudflare R2 or S3",
      purpose: "Stores uploads, narration and rendered videos",
      state: hasS3() ? "connected" : "local",
      detail: hasS3() ? "Writing to your bucket." : "Writing to this machine's disk (.data/storage).",
      envVars: ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"],
      docsUrl: "https://developers.cloudflare.com/r2/api/s3/tokens/",
    },
    {
      key: "openai",
      name: "OpenAI",
      purpose: "Scoring, research, scripts, highlight detection and transcription",
      state: hasLlm() ? "connected" : "not_configured",
      detail: hasLlm()
        ? `Using ${process.env.OPENAI_MODEL ?? "gpt-4o-mini"}.`
        : "AI scripts, transcription and clip detection stay off. You can still write your own script or cut clips by timecode.",
      envVars: ["OPENAI_API_KEY"],
      docsUrl: "https://platform.openai.com/api-keys",
    },
    {
      key: "tts",
      name: "Voiceover",
      purpose: "Narration for faceless videos",
      state: tts === "macos-say" || tts === "kokoro" ? "local" : "connected",
      detail:
        tts === "macos-say"
          ? "Using this Mac's built-in voices, for testing only. Apple's license limits them to non-commercial use."
          : tts === "kokoro"
            ? "Using Kokoro, a free voice that runs on this machine. Add ElevenLabs or OpenAI for other voices."
            : `Using ${tts}.`,
      envVars: ["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"],
      docsUrl: "https://elevenlabs.io/app/settings/api-keys",
    },
    {
      key: "stock",
      name: "Stock footage",
      purpose: "Licensed stock B-roll from Pixabay or Pexels",
      state: getStock() ? "connected" : "not_configured",
      detail: getStock() ? `Searching ${getStock()?.name === "pexels" ? "Pexels" : "Pixabay"} for each scene.` : "Scenes use typographic cards until you add a key or upload B-roll.",
      envVars: ["PIXABAY_API_KEY", "PEXELS_API_KEY"],
      docsUrl: "https://pixabay.com/api/docs/",
    },
    {
      key: "youtube",
      name: "YouTube Data API",
      purpose: "Finds niche videos and topics (metadata only)",
      state: hasYoutube() ? "connected" : "not_configured",
      detail: hasYoutube() ? "Discovery searches are live." : "Discovery searches stay off until you add a key.",
      envVars: ["YOUTUBE_API_KEY"],
      docsUrl: "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
    },
    {
      key: "wikipedia",
      name: "Wikipedia",
      purpose: "Source material for fact checking",
      state: "connected",
      detail: "Public API. No key needed.",
      envVars: [],
    },
    {
      key: "meta",
      name: "Instagram and Facebook",
      purpose: "Publish Reels",
      state: "planned",
      detail: "Arrives with social publishing in Phase 2. Export MP4s for now.",
      envVars: ["META_APP_ID", "META_APP_SECRET"],
    },
    {
      key: "stripe",
      name: "Stripe",
      purpose: "Subscriptions and usage billing",
      state: "planned",
      detail: "Arrives with billing in Phase 4. Usage is already metered.",
      envVars: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    },
  ];
}
