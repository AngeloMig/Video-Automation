import { z } from "zod";

/**
 * The single description of a video. The editor's Player and the worker's renderer both draw
 * this exact spec through src/remotion/Timeline.tsx, so preview and export stay consistent.
 * Media is referenced by asset id and resolved to a URL at draw time through `assetUrls`.
 */
export const TIMELINE_FPS = 30;
export const TIMELINE_WIDTH = 1080;
export const TIMELINE_HEIGHT = 1920;

const frames = z.number().int().nonnegative();

export const visualClipSchema = z.object({
  id: z.string(),
  sceneId: z.string().optional(),
  type: z.enum(["video", "image", "card"]),
  assetId: z.string().optional(),
  from: frames,
  durationInFrames: z.number().int().positive(),
  trimStartFrames: frames.default(0),
  /** Horizontal crop focus for 9:16 reframing: 0 is the left edge, 1 the right. */
  focusX: z.number().min(0).max(1).default(0.5),
  volume: z.number().min(0).max(2).default(0),
  transition: z.enum(["cut", "fade"]).default("cut"),
  transitionFrames: frames.default(0),
  /** Text drawn by type "card" clips when there is no footage for a scene. */
  cardText: z.string().optional(),
  /** Slow camera move across the clip. "punch" adds a quick zoom and flash on its first frames. */
  motion: z.enum(["none", "push", "pull"]).default("none"),
  punch: z.boolean().default(false),
});

export const audioClipSchema = z.object({
  id: z.string(),
  sceneId: z.string().optional(),
  assetId: z.string(),
  from: frames,
  durationInFrames: z.number().int().positive(),
  trimStartFrames: frames.default(0),
  volume: z.number().min(0).max(2).default(1),
  speakerIndex: z.number().int().nonnegative().optional(),
  /** Measured loudness per frame of the source audio, 0 to 1, which drives the waveform. */
  levels: z.array(z.number()).optional(),
});

export const captionCueSchema = z.object({
  id: z.string(),
  from: frames,
  durationInFrames: z.number().int().positive(),
  text: z.string(),
  speakerIndex: z.number().int().nonnegative().optional(),
  /** Per-word frame offsets from the start of the cue, for the active-word highlight. */
  words: z.array(z.object({ text: z.string(), from: frames, to: frames })).default([]),
});

export const textOverlaySchema = z.object({
  id: z.string(),
  from: frames,
  durationInFrames: z.number().int().positive(),
  text: z.string(),
  role: z.enum(["kinetic", "intro", "outro", "stat"]).default("kinetic"),
  /** Small line under a "stat" overlay. */
  label: z.string().optional(),
  speakerIndex: z.number().int().nonnegative().optional(),
});

export const captionStyleSchema = z.object({
  preset: z.string().default("signal"),
  fontFamily: z.string().default("Inter, Helvetica, Arial, sans-serif"),
  fontSize: z.number().min(24).max(140).default(68),
  textColor: z.string().default("#F5F7FA"),
  highlightColor: z.string().default("#58D5C9"),
  uppercase: z.boolean().default(false),
  /** Share of frame height, measured from the top, where captions sit. */
  positionY: z.number().min(0.1).max(0.9).default(0.68),
  background: z.boolean().default(true),
});

export const timelineSpecSchema = z.object({
  version: z.literal(1),
  fps: z.literal(TIMELINE_FPS),
  width: z.literal(TIMELINE_WIDTH),
  height: z.literal(TIMELINE_HEIGHT),
  durationInFrames: z.number().int().positive(),
  tracks: z.object({
    visual: z.array(visualClipSchema),
    narration: z.array(audioClipSchema),
    music: z.array(audioClipSchema),
    captions: z.array(captionCueSchema),
    text: z.array(textOverlaySchema),
  }),
  style: z.object({
    template: z.string().default("signal"),
    caption: captionStyleSchema,
    brandPrimary: z.string().default("#58D5C9"),
    brandSecondary: z.string().default("#77A9FF"),
    watermarkAssetId: z.string().optional(),
    /** Set when any visual or voice is AI-generated, so the disclosure can be drawn and stored. */
    syntheticMediaDisclosure: z.boolean().default(false),
    /** Present on the podcast format: the show title and each host's name and color. */
    podcast: z
      .object({
        title: z.string().optional(),
        speakers: z.array(z.object({ name: z.string(), color: z.string() })).min(1),
      })
      .optional(),
  }),
});

export type TimelineSpec = z.infer<typeof timelineSpecSchema>;
export type VisualClip = z.infer<typeof visualClipSchema>;
export type AudioClip = z.infer<typeof audioClipSchema>;
export type CaptionCue = z.infer<typeof captionCueSchema>;
export type TextOverlay = z.infer<typeof textOverlaySchema>;
export type CaptionStyle = z.infer<typeof captionStyleSchema>;

export type TimelineProps = {
  spec: TimelineSpec;
  assetUrls: Record<string, string>;
};

export function secondsToFrames(seconds: number) {
  return Math.round(seconds * TIMELINE_FPS);
}

/** Every asset id the spec draws, so callers can resolve URLs for exactly those assets. */
export function collectAssetIds(spec: TimelineSpec): string[] {
  const ids = new Set<string>();
  for (const clip of spec.tracks.visual) if (clip.assetId) ids.add(clip.assetId);
  for (const clip of [...spec.tracks.narration, ...spec.tracks.music]) ids.add(clip.assetId);
  if (spec.style.watermarkAssetId) ids.add(spec.style.watermarkAssetId);
  return [...ids];
}
