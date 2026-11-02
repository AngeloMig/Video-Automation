import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { assertOk, PermanentError } from "./errors";
import type { TextToSpeechProvider } from "./types";

const exec = promisify(execFile);

type Alignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

/** Rebuilds word timings from ElevenLabs' per-character alignment. */
export function wordsFromAlignment(alignment: Alignment) {
  const words: { word: string; start: number; end: number }[] = [];
  let current: { word: string; start: number; end: number } | null = null;
  alignment.characters.forEach((character, index) => {
    if (/\s/.test(character)) {
      if (current) words.push(current);
      current = null;
      return;
    }
    const start = alignment.character_start_times_seconds[index];
    const end = alignment.character_end_times_seconds[index];
    if (current) {
      current.word += character;
      current.end = end;
    } else {
      current = { word: character, start, end };
    }
  });
  if (current) words.push(current);
  return words;
}

export const elevenLabsTts: TextToSpeechProvider = {
  name: "elevenlabs",
  isSynthetic: true,
  async listVoices() {
    const response = await fetch(`${elevenLabsBase()}/v1/voices`, {
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "" },
    });
    await assertOk(response, "ElevenLabs");
    const body = (await response.json()) as { voices: { voice_id: string; name: string }[] };
    return body.voices.map((voice) => ({ id: voice.voice_id, label: voice.name }));
  },
  async synthesize({ text, voiceId, speed, outputPathWithoutExt }, options = {}) {
    const voice = voiceId ?? process.env.ELEVENLABS_VOICE_ID;
    if (!voice) throw new PermanentError("Choose a voice in the project settings or set ELEVENLABS_VOICE_ID.", "voice_missing");
    const model = process.env.ELEVENLABS_MODEL ?? "eleven_multilingual_v2";
    const response = await fetch(`${elevenLabsBase()}/v1/text-to-speech/${encodeURIComponent(voice)}/with-timestamps`, {
      method: "POST",
      signal: options.signal,
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "", "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: model, voice_settings: speed ? { speed } : undefined }),
    });
    await assertOk(response, "ElevenLabs");
    const body = (await response.json()) as { audio_base64: string; alignment: Alignment | null };
    const path = `${outputPathWithoutExt}.mp3`;
    await writeFile(path, Buffer.from(body.audio_base64, "base64"));
    options.onUsage?.({
      kind: "tts",
      provider: `elevenlabs:${model}`,
      quantity: text.length,
      unit: "characters",
      costMicroUsd: Math.round(text.length * 180),
    });
    return { path, format: "mp3", words: body.alignment ? wordsFromAlignment(body.alignment) : null };
  },
};

function elevenLabsBase() {
  return (process.env.ELEVENLABS_BASE_URL ?? "https://api.elevenlabs.io").replace(/\/$/, "");
}

/** The better-rated English voices, by the grades on the model's own voice list. */
export const KOKORO_VOICES = [
  { id: "af_heart", label: "Heart (American, female)" },
  { id: "af_bella", label: "Bella (American, female)" },
  { id: "af_nicole", label: "Nicole (American, female)" },
  { id: "af_aoede", label: "Aoede (American, female)" },
  { id: "af_kore", label: "Kore (American, female)" },
  { id: "af_sarah", label: "Sarah (American, female)" },
  { id: "am_michael", label: "Michael (American, male)" },
  { id: "am_fenrir", label: "Fenrir (American, male)" },
  { id: "am_puck", label: "Puck (American, male)" },
  { id: "bf_emma", label: "Emma (British, female)" },
  { id: "bm_fable", label: "Fable (British, male)" },
  { id: "bm_george", label: "George (British, male)" },
];
type KokoroVoice = "af_heart";

/** Mono 16-bit PCM WAV from Kokoro's floating point samples. */
export function encodeWav(samples: Float32Array, sampleRate: number) {
  const header = Buffer.alloc(44);
  const dataBytes = samples.length * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);
  const data = Buffer.alloc(dataBytes);
  samples.forEach((sample, index) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), index * 2));
  return Buffer.concat([header, data]);
}

/** One Kokoro call cuts off at the model's token limit, so long narration goes in pieces, sentence by sentence. */
export function chunkNarration(text: string, maxChars = 300) {
  const pieces = text.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]*["')\]]*\s*/g) ?? [];
  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };
  for (const piece of pieces) {
    if (current.length + piece.length > maxChars) flush();
    if (piece.length <= maxChars) {
      current += piece;
      continue;
    }
    // A single sentence over the limit breaks between words.
    for (const word of piece.split(" ")) {
      if (current.length + word.length + 1 > maxChars) flush();
      current += `${word} `;
    }
  }
  flush();
  return chunks;
}

let kokoroModel: Promise<import("kokoro-js").KokoroTTS> | null = null;
function loadKokoro() {
  // Imported on first use so the web process never loads the model. Downloads about 92 MB once.
  kokoroModel ??= import("kokoro-js")
    .then(({ KokoroTTS }) => KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" }))
    .catch((error) => {
      kokoroModel = null;
      throw error;
    });
  return kokoroModel;
}

/** Kokoro: Apache-2.0 speech model that runs on the worker's CPU, with no key and no cost. */
export const kokoroTts: TextToSpeechProvider = {
  name: "kokoro",
  isSynthetic: true,
  async listVoices() {
    return KOKORO_VOICES;
  },
  async synthesize({ text, voiceId, speed, outputPathWithoutExt }, options = {}) {
    const model = await loadKokoro();
    // A project may still hold a voice chosen under another provider.
    const voice = (KOKORO_VOICES.some((option) => option.id === voiceId) ? voiceId : KOKORO_VOICES[0].id) as KokoroVoice;
    const chunks: Float32Array[] = [];
    let sampleRate = 24000;
    for (const chunk of chunkNarration(text)) {
      options.signal?.throwIfAborted();
      const audio = await model.generate(chunk, { voice, speed: speed ?? 1 });
      chunks.push(audio.audio);
      sampleRate = audio.sampling_rate;
    }
    if (chunks.length === 0) throw new PermanentError("Kokoro produced no audio for this text.", "tts_empty");
    const samples = new Float32Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    const path = `${outputPathWithoutExt}.wav`;
    await writeFile(path, encodeWav(samples, sampleRate));
    options.onUsage?.({ kind: "tts", provider: "kokoro", quantity: text.length, unit: "characters", costMicroUsd: 0 });
    return { path, format: "wav", words: null };
  },
};

/** English voice names from `say -v ?`. Long names have only one space before the locale. */
export function parseSayVoices(output: string) {
  return output.split("\n").flatMap((line) => line.match(/^(.+?)\s+en_[A-Z]{2}\b/)?.[1] ?? []);
}

/** macOS `say`. Real offline speech for local development, with no key and no cost. */
export const systemTts: TextToSpeechProvider = {
  name: "macos-say",
  isSynthetic: true,
  async listVoices() {
    const { stdout } = await exec("say", ["-v", "?"]);
    return parseSayVoices(stdout).map((id) => ({ id, label: id }));
  },
  async synthesize({ text, voiceId, speed, outputPathWithoutExt }, options = {}) {
    const path = `${outputPathWithoutExt}.aiff`;
    const args = ["-o", path, "-r", String(Math.round(180 * (speed ?? 1)))];
    if (voiceId) args.push("-v", voiceId);
    args.push("--", text);
    await exec("say", args, { signal: options.signal });
    options.onUsage?.({ kind: "tts", provider: "macos-say", quantity: text.length, unit: "characters", costMicroUsd: 0 });
    return { path, format: "aiff", words: null };
  },
};
