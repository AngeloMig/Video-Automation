import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";

const exec = promisify(execFile);
const MAX_OUTPUT = 32 * 1024 * 1024;

// Resolved at call time so the Next.js bundler never tries to trace the binaries.
const nodeRequire = createRequire(`${process.cwd()}/package.json`);

function ffmpegPath(): string {
  return process.env.FFMPEG_PATH ?? (nodeRequire("ffmpeg-static") as string);
}
function ffprobePath(): string {
  return process.env.FFPROBE_PATH ?? (nodeRequire("ffprobe-static") as { path: string }).path;
}

export type MediaProbe = {
  durationSeconds: number;
  width: number | null;
  height: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec: string | null;
  formatName: string;
};

type ProbeJson = {
  format?: { duration?: string; format_name?: string };
  streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; duration?: string }[];
};

/** Reads the actual container. Throws if ffprobe can't parse it, which is how uploads are validated. */
export async function probeMedia(input: string, signal?: AbortSignal): Promise<MediaProbe> {
  const { stdout } = await exec(
    ffprobePath(),
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", input],
    { signal, maxBuffer: MAX_OUTPUT },
  );
  const data = JSON.parse(stdout) as ProbeJson;
  const video = data.streams?.find((stream) => stream.codec_type === "video");
  const audio = data.streams?.find((stream) => stream.codec_type === "audio");
  return {
    durationSeconds: Number(data.format?.duration ?? video?.duration ?? audio?.duration ?? 0),
    width: video?.width ?? null,
    height: video?.height ?? null,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    videoCodec: video?.codec_name ?? null,
    formatName: data.format?.format_name ?? "",
  };
}

async function run(args: string[], signal?: AbortSignal) {
  try {
    return await exec(ffmpegPath(), ["-hide_banner", "-y", ...args], { signal, maxBuffer: MAX_OUTPUT });
  } catch (error) {
    if (signal?.aborted) throw error;
    // FFmpeg prints its banner first, so the cause is at the end of stderr.
    const stderr = String((error as { stderr?: string }).stderr ?? error);
    throw new Error(`FFmpeg failed: ${stderr.trim().split("\n").slice(-6).join(" | ").slice(-800)}`);
  }
}

/** Mono low-bitrate speech track, small enough for transcription APIs. */
export async function extractSpeechAudio(input: string, output: string, signal?: AbortSignal) {
  await run(["-i", input, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", output], signal);
}

export async function convertToMp3(input: string, output: string, signal?: AbortSignal) {
  await run(["-i", input, "-vn", "-ac", "2", "-ar", "44100", "-b:a", "160k", output], signal);
}

/** Loudness of each block of samples, 0 to 1 relative to the loudest block, rounded to keep specs small. */
export function levelsFromSamples(samples: ArrayLike<number>, samplesPerBlock: number): number[] {
  const levels: number[] = [];
  for (let start = 0; start < samples.length; start += samplesPerBlock) {
    const end = Math.min(start + samplesPerBlock, samples.length);
    let sum = 0;
    for (let index = start; index < end; index++) sum += samples[index] * samples[index];
    levels.push(Math.sqrt(sum / (end - start)));
  }
  const peak = Math.max(...levels, 0);
  return peak > 0 ? levels.map((level) => Math.round((level / peak) * 100) / 100) : levels.map(() => 0);
}

/** Measures an audio file's loudness per video frame, which drives the waveform in a render. */
export async function audioLevels(path: string, fps: number, signal?: AbortSignal): Promise<number[]> {
  const sampleRate = 8000;
  const { stdout } = await exec(ffmpegPath(), ["-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", String(sampleRate), "-f", "f32le", "-"], {
    encoding: "buffer",
    maxBuffer: MAX_OUTPUT,
    signal,
  });
  const samples = new Float32Array(Math.floor(stdout.length / 4));
  for (let index = 0; index < samples.length; index++) samples[index] = stdout.readFloatLE(index * 4);
  return levelsFromSamples(samples, Math.round(sampleRate / fps));
}

const SILENCE_DB = -70;

/**
 * EBU R128 normalisation to the -14 LUFS short-form platforms target, leaving the video stream
 * as is. loudnorm produces NaN on digital silence, so silent audio is only remuxed. Returns
 * whether the audio was actually normalised.
 */
export async function normalizeLoudness(input: string, output: string, signal?: AbortSignal): Promise<boolean> {
  const remux = () => run(["-i", input, "-c", "copy", "-movflags", "+faststart", output], signal);
  const volume = await meanVolumeDb(input, signal);
  if (volume === null || volume < SILENCE_DB) {
    await remux();
    return false;
  }
  try {
    await run(
      ["-i", input, "-c:v", "copy", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output],
      signal,
    );
    return true;
  } catch (error) {
    if (signal?.aborted) throw error;
    // Long silent stretches can still trip the filter. A correct video beats a failed render.
    await remux();
    return false;
  }
}

export async function extractThumbnail(input: string, output: string, atSeconds: number, signal?: AbortSignal) {
  await run(["-ss", String(Math.max(atSeconds, 0)), "-i", input, "-frames:v", "1", "-q:v", "3", output], signal);
}

/** Mean volume in dB, or null when there's no audio to measure. */
export async function meanVolumeDb(input: string, signal?: AbortSignal): Promise<number | null> {
  const { stderr } = await run(["-i", input, "-af", "volumedetect", "-vn", "-f", "null", "-"], signal);
  const match = stderr.match(/mean_volume:\s*(-?[\d.]+|-inf) dB/);
  if (!match) return null;
  return match[1] === "-inf" ? Number.NEGATIVE_INFINITY : Number(match[1]);
}
