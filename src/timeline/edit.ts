import type { AudioClip, CaptionCue, TextOverlay, TimelineSpec, VisualClip } from "./spec";

/**
 * Pure editor operations. Each returns a new spec, so the editor gets undo for free and the same
 * functions can be unit tested without a browser.
 */
type Spanned = { from: number; durationInFrames: number };

/** Removes [start, end) from a track, shifting later items left and shortening items it crosses. */
function cutTrack<T extends Spanned>(items: T[], start: number, end: number, advanceTrim: (item: T, frames: number) => T): T[] {
  const removed = end - start;
  const output: T[] = [];
  for (const item of items) {
    const itemEnd = item.from + item.durationInFrames;
    if (itemEnd <= start) {
      output.push(item);
    } else if (item.from >= end) {
      output.push({ ...item, from: item.from - removed });
    } else if (item.from < start && itemEnd > end) {
      output.push({ ...item, durationInFrames: item.durationInFrames - removed });
    } else if (item.from < start) {
      output.push({ ...item, durationInFrames: start - item.from });
    } else if (itemEnd > end) {
      const cutFromHead = end - item.from;
      output.push(advanceTrim({ ...item, from: start, durationInFrames: item.durationInFrames - cutFromHead }, cutFromHead));
    }
    // Anything left is entirely inside the removed range, so it's dropped.
  }
  return output;
}

function totalFrames(tracks: TimelineSpec["tracks"]) {
  const spans = [...tracks.visual, ...tracks.narration, ...tracks.captions];
  return spans.reduce((max, item) => Math.max(max, item.from + item.durationInFrames), 0);
}

const advanceClip = <T extends VisualClip | AudioClip>(clip: T, frames: number): T => ({ ...clip, trimStartFrames: clip.trimStartFrames + frames });
const advanceNothing = <T>(item: T) => item;

/** Ripple delete across every track. Music is re-trimmed to the new length, never shifted. */
export function removeRange(spec: TimelineSpec, start: number, end: number): TimelineSpec {
  if (end <= start) return spec;
  const tracks = {
    visual: cutTrack(spec.tracks.visual, start, end, advanceClip),
    narration: cutTrack(spec.tracks.narration, start, end, advanceClip),
    captions: cutTrack<CaptionCue>(spec.tracks.captions, start, end, (cue, frames) => ({
      ...cue,
      words: cue.words.map((word) => ({ ...word, from: Math.max(word.from - frames, 0), to: Math.max(word.to - frames, 1) })),
    })),
    text: cutTrack<TextOverlay>(spec.tracks.text, start, end, advanceNothing),
    music: spec.tracks.music,
  };
  const durationInFrames = totalFrames(tracks);
  if (durationInFrames <= 0) throw new Error("A video can't be empty.");
  return { ...spec, durationInFrames, tracks: { ...tracks, music: trimMusic(tracks.music, durationInFrames) } };
}

function trimMusic(music: AudioClip[], total: number) {
  return music
    .filter((clip) => clip.from < total)
    .map((clip) => ({ ...clip, durationInFrames: Math.min(clip.durationInFrames, total - clip.from) }));
}

export function splitVisualAt(spec: TimelineSpec, frame: number): TimelineSpec {
  const clip = spec.tracks.visual.find((c) => frame > c.from && frame < c.from + c.durationInFrames);
  if (!clip) return spec;
  const headFrames = frame - clip.from;
  const head: VisualClip = { ...clip, durationInFrames: headFrames };
  const tail: VisualClip = { ...clip, id: `${clip.id}-s${frame}`, from: frame, durationInFrames: clip.durationInFrames - headFrames, trimStartFrames: clip.trimStartFrames + headFrames, transition: "cut", transitionFrames: 0 };
  const visual = spec.tracks.visual.flatMap((c) => (c.id === clip.id ? [head, tail] : [c]));
  return { ...spec, tracks: { ...spec.tracks, visual } };
}

export function trimVisual(spec: TimelineSpec, clipId: string, edge: "start" | "end", frames: number): TimelineSpec {
  const clip = spec.tracks.visual.find((c) => c.id === clipId);
  if (!clip || frames <= 0) return spec;
  const amount = Math.min(frames, clip.durationInFrames - 1);
  return edge === "start" ? removeRange(spec, clip.from, clip.from + amount) : removeRange(spec, clip.from + clip.durationInFrames - amount, clip.from + clip.durationInFrames);
}

export function deleteVisual(spec: TimelineSpec, clipId: string): TimelineSpec {
  const clip = spec.tracks.visual.find((c) => c.id === clipId);
  return clip ? removeRange(spec, clip.from, clip.from + clip.durationInFrames) : spec;
}

export type SceneBlock = { key: string; from: number; durationInFrames: number; clipIds: string[] };

/** Scenes in order. Clips from one scene, such as repeats of short footage, move together. */
export function sceneBlocks(spec: TimelineSpec): SceneBlock[] {
  const blocks: SceneBlock[] = [];
  for (const clip of [...spec.tracks.visual].sort((a, b) => a.from - b.from)) {
    const last = blocks[blocks.length - 1];
    if (last && clip.sceneId && last.key === clip.sceneId) {
      last.durationInFrames += clip.durationInFrames;
      last.clipIds.push(clip.id);
    } else {
      blocks.push({ key: clip.sceneId ?? clip.id, from: clip.from, durationInFrames: clip.durationInFrames, clipIds: [clip.id] });
    }
  }
  return blocks;
}

/** Moves a scene earlier or later. Its narration and captions travel with it. */
export function moveScene(spec: TimelineSpec, key: string, direction: -1 | 1): TimelineSpec {
  const blocks = sceneBlocks(spec);
  const index = blocks.findIndex((block) => block.key === key);
  const swapWith = index + direction;
  if (index < 0 || swapWith < 0 || swapWith >= blocks.length) return spec;

  const reordered = [...blocks];
  [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];
  let cursor = 0;
  const offsets = reordered.map((block) => {
    const entry = { start: block.from, end: block.from + block.durationInFrames, delta: cursor - block.from };
    cursor += block.durationInFrames;
    return entry;
  });
  const shift = <T extends Spanned>(item: T): T => {
    const match = offsets.find((entry) => item.from >= entry.start && item.from < entry.end);
    return match ? { ...item, from: item.from + match.delta } : item;
  };
  const byFrom = <T extends Spanned>(a: T, b: T) => a.from - b.from;
  return {
    ...spec,
    tracks: {
      visual: spec.tracks.visual.map(shift).sort(byFrom),
      narration: spec.tracks.narration.map(shift).sort(byFrom),
      captions: spec.tracks.captions.map(shift).sort(byFrom),
      // A hook stays at the start of the video, while a stat belongs to its scene.
      text: spec.tracks.text.map((overlay) => (overlay.role === "stat" ? shift(overlay) : overlay)),
      music: spec.tracks.music,
    },
  };
}

export function updateVisual(spec: TimelineSpec, clipId: string, patch: Partial<VisualClip>): TimelineSpec {
  return { ...spec, tracks: { ...spec.tracks, visual: spec.tracks.visual.map((clip) => (clip.id === clipId ? { ...clip, ...patch } : clip)) } };
}

/** Swaps a clip's footage. It keeps its timing, and repeats are left for the next assemble. */
export function replaceVisualAsset(spec: TimelineSpec, clipId: string, asset: { id: string; kind: "video" | "image" }): TimelineSpec {
  return updateVisual(spec, clipId, { type: asset.kind, assetId: asset.id, trimStartFrames: 0, volume: 0 });
}

export function updateCaptionText(spec: TimelineSpec, cueId: string, text: string): TimelineSpec {
  return {
    ...spec,
    tracks: {
      ...spec.tracks,
      captions: spec.tracks.captions.map((cue) => {
        if (cue.id !== cueId) return cue;
        // The old word timings no longer match, so word highlighting is spread across the new text.
        const tokens = text.split(/\s+/).filter(Boolean);
        const step = cue.durationInFrames / Math.max(tokens.length, 1);
        return { ...cue, text, words: tokens.map((token, index) => ({ text: token, from: Math.round(index * step), to: Math.round((index + 1) * step) })) };
      }),
    },
  };
}

export function updateCaptionStyle(spec: TimelineSpec, patch: Partial<TimelineSpec["style"]["caption"]>): TimelineSpec {
  return { ...spec, style: { ...spec.style, caption: { ...spec.style.caption, ...patch } } };
}

export function setTrackVolume(spec: TimelineSpec, track: "narration" | "music", volume: number): TimelineSpec {
  return { ...spec, tracks: { ...spec.tracks, [track]: spec.tracks[track].map((clip) => ({ ...clip, volume })) } };
}

export function setSourceVolume(spec: TimelineSpec, volume: number): TimelineSpec {
  return { ...spec, tracks: { ...spec.tracks, visual: spec.tracks.visual.map((clip) => (clip.type === "video" ? { ...clip, volume } : clip)) } };
}
