import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { assertOk, PermanentError } from "./errors";
import type { CallOptions, LlmProvider, SpeechToTextProvider, TextToSpeechProvider, TranscriptionResult } from "./types";

function baseUrl() {
  return (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
}
function auth() {
  return { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` };
}

function perMillion(envVar: string, fallback: number) {
  return Number(process.env[envVar] ?? fallback);
}

export const openAiLlm: LlmProvider = {
  name: "openai",
  async generateJson({ system, user, schema, temperature = 0.4 }, options: CallOptions = {}) {
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    const response = await fetch(`${baseUrl()}/chat/completions`, {
      method: "POST",
      signal: options.signal,
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `${system}\nRespond with a single JSON object only.` },
          { role: "user", content: user },
        ],
      }),
    });
    await assertOk(response, "OpenAI");
    const body = (await response.json()) as {
      choices: { message: { content: string | null } }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    if (body.usage) {
      const { prompt_tokens: input, completion_tokens: output } = body.usage;
      options.onUsage?.({
        kind: "llm",
        provider: `openai:${model}`,
        quantity: input + output,
        unit: "tokens",
        costMicroUsd: Math.round(
          input * perMillion("OPENAI_INPUT_USD_PER_MTOK", 0.15) + output * perMillion("OPENAI_OUTPUT_USD_PER_MTOK", 0.6),
        ),
      });
    }
    const content = body.choices[0]?.message.content ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Malformed model output is worth retrying, so this stays a plain Error.
      throw new Error(`OpenAI returned invalid JSON: ${content.slice(0, 200)}`);
    }
    const result = schema.safeParse(parsed);
    if (!result.success) throw new Error(`OpenAI response did not match the schema: ${result.error.message.slice(0, 400)}`);
    return result.data;
  },
};

export const openAiStt: SpeechToTextProvider = {
  name: "openai",
  async transcribe(audioPath, options = {}) {
    const bytes = await readFile(audioPath);
    if (bytes.byteLength > 25 * 1024 * 1024) {
      throw new PermanentError("Audio is over the 25 MB transcription limit. Upload a shorter source video.", "source_too_long");
    }
    const model = process.env.OPENAI_STT_MODEL ?? "whisper-1";
    const form = new FormData();
    form.set("file", new Blob([bytes], { type: "audio/mpeg" }), basename(audioPath));
    form.set("model", model);
    form.set("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    form.append("timestamp_granularities[]", "segment");
    if (options.language) form.set("language", options.language);

    const response = await fetch(`${baseUrl()}/audio/transcriptions`, {
      method: "POST",
      signal: options.signal,
      headers: auth(),
      body: form,
    });
    await assertOk(response, "OpenAI transcription");
    const body = (await response.json()) as {
      text: string;
      language?: string;
      duration?: number;
      words?: { word: string; start: number; end: number }[];
      segments?: { start: number; end: number; text: string }[];
    };
    const minutes = (body.duration ?? 0) / 60;
    options.onUsage?.({
      kind: "transcription",
      provider: `openai:${model}`,
      quantity: minutes,
      unit: "minutes",
      costMicroUsd: Math.round(minutes * 6000),
    });
    return {
      text: body.text,
      language: body.language,
      words: body.words ?? [],
      segments: (body.segments ?? []).map((s) => ({ start: s.start, end: s.end, text: s.text.trim() })),
    } satisfies TranscriptionResult;
  },
};

const OPENAI_VOICES = ["alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"];

export const openAiTts: TextToSpeechProvider = {
  name: "openai",
  isSynthetic: true,
  async listVoices() {
    return OPENAI_VOICES.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1) }));
  },
  async synthesize({ text, voiceId, speed, outputPathWithoutExt }, options = {}) {
    const model = process.env.OPENAI_TTS_MODEL ?? "tts-1";
    const response = await fetch(`${baseUrl()}/audio/speech`, {
      method: "POST",
      signal: options.signal,
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: text, voice: voiceId ?? "alloy", speed: speed ?? 1, response_format: "mp3" }),
    });
    await assertOk(response, "OpenAI speech");
    const path = `${outputPathWithoutExt}.mp3`;
    await writeFile(path, Buffer.from(await response.arrayBuffer()));
    options.onUsage?.({
      kind: "tts",
      provider: `openai:${model}`,
      quantity: text.length,
      unit: "characters",
      costMicroUsd: Math.round(text.length * 15),
    });
    return { path, format: "mp3", words: null };
  },
};
