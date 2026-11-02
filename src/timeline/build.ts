import {
  type CaptionCue,
  type CaptionStyle,
  captionStyleSchema,
  secondsToFrames,
  TIMELINE_FPS,
  TIMELINE_HEIGHT,
  TIMELINE_WIDTH,
  type TextOverlay,
  type TimelineSpec,
  timelineSpecSchema,
  type VisualClip,
} from "./spec";

export type Word = { word: string; start: number; end: number };

export type TemplateId = "signal" | "documentary" | "bold" | "podcast" | "runner";

export type Template = {
  id: TemplateId;
  name: string;
  description: string;
  caption: Partial<CaptionStyle>;
  transition: "cut" | "fade";
  transitionFrames: number;
  maxWordsPerCue: number;
  hookOverlay: boolean;
  /** Slow camera moves on footage, and a quick zoom on each new scene. */
  motion?: boolean;
};

export const TEMPLATES: Template[] = [
  {
    id: "signal",
    name: "Signal",
    description: "Clean captions with a highlighted active word. A good default for explainers.",
    caption: { preset: "signal", fontSize: 68, positionY: 0.68, background: true },
    transition: "cut",
    transitionFrames: 0,
    maxWordsPerCue: 4,
    hookOverlay: true,
  },
  {
    id: "documentary",
    name: "Documentary",
    description: "Slower fades and quieter captions for storytelling and history.",
    caption: { preset: "documentary", fontSize: 54, positionY: 0.76, background: false },
    transition: "fade",
    transitionFrames: 12,
    maxWordsPerCue: 6,
    hookOverlay: false,
  },
  {
    id: "bold",
    name: "Bold",
    description: "Large uppercase captions with fast cuts for energetic content.",
    caption: { preset: "bold", fontSize: 88, positionY: 0.56, background: false, uppercase: true },
    transition: "cut",
    transitionFrames: 0,
    maxWordsPerCue: 3,
    hookOverlay: true,
  },
  {
    id: "podcast",
    name: "Podcast",
    description: "A two-host conversation over footage, with a live waveform, host tags and big stats. Picked automatically when a script names its speakers.",
    caption: { preset: "podcast", fontSize: 84, positionY: 0.5, background: false },
    transition: "cut",
    transitionFrames: 0,
    maxWordsPerCue: 4,
    hookOverlay: false,
    motion: true,
  },
  {
    id: "runner",
    name: "Split Runner",
    description: "Footage on top, an original endless-runner animation below, and huge captions on the seam. Built for fast, high-energy stories.",
    caption: { preset: "runner", fontSize: 122, positionY: 0.5, background: false, uppercase: true, highlightColor: "#FDE047" },
    transition: "cut",
    transitionFrames: 0,
    maxWordsPerCue: 3,
    hookOverlay: false,
    motion: true,
  },
];

/** Picks the voice for each host in order of appearance, so two hosts never share one and sound different. */
export function pickSpeakerVoice(voices: { id: string; label: string }[], speakerIndex: number, firstVoiceId?: string | null): string | undefined {
  const first = firstVoiceId ?? voices[0]?.id;
  if (speakerIndex === 0) return first;
  const others = voices.filter((voice) => voice.id !== first);
  const firstLabel = voices.find((voice) => voice.id === first)?.label.toLowerCase() ?? "";
  const firstIsFemale = firstLabel.includes("female");
  const contrasting = others.filter((voice) => /\bmale\b|\bfemale\b/i.test(voice.label) && /\bfemale\b/i.test(voice.label) !== firstIsFemale);
  const ordered = [...contrasting, ...others.filter((voice) => !contrasting.includes(voice))];
  return ordered[(speakerIndex - 1) % Math.max(ordered.length, 1)]?.id ?? first;
}

export function getTemplate(id: string | null | undefined): Template {
  return TEMPLATES.find((template) => template.id === id) ?? TEMPLATES[0];
}

export type BrandStyle = {
  brandPrimary: string;
  brandSecondary: string;
  watermarkAssetId?: string | null;
};

function styleFor(template: Template, brand: BrandStyle, syntheticMediaDisclosure: boolean): TimelineSpec["style"] {
  return {
    template: template.id,
    caption: captionStyleSchema.parse({ highlightColor: brand.brandPrimary, ...template.caption }),
    brandPrimary: brand.brandPrimary,
    brandSecondary: brand.brandSecondary,
    watermarkAssetId: brand.watermarkAssetId ?? undefined,
    syntheticMediaDisclosure,
  };
}

/**
 * Groups timed words into short caption cues. A cue breaks at sentence punctuation, at the word
 * limit, at long pauses, or once it has been on screen for 2.4 seconds.
 */
export function buildCaptionCues(words: Word[], maxWords: number, startFrame = 0, idPrefix = "cue"): CaptionCue[] {
  const cues: CaptionCue[] = [];
  let group: Word[] = [];

  const flush = () => {
    if (group.length === 0) return;
    const from = secondsToFrames(group[0].start) + startFrame;
    const to = Math.max(secondsToFrames(group[group.length - 1].end) + startFrame, from + 1);
    cues.push({
      id: `${idPrefix}-${cues.length}`,
      from,
      durationInFrames: to - from,
      text: group.map((word) => word.word.trim()).join(" "),
      words: group.map((word) => ({
        text: word.word.trim(),
        from: Math.max(secondsToFrames(word.start) + startFrame - from, 0),
        to: Math.max(secondsToFrames(word.end) + startFrame - from, 1),
      })),
    });
    group = [];
  };

  for (const word of words) {
    const previous = group[group.length - 1];
    const pause = previous ? word.start - previous.end : 0;
    const tooLong = group.length > 0 && word.end - group[0].start > 2.4;
    if (pause > 0.6 || tooLong) flush();
    group.push(word);
    if (group.length >= maxWords || /[.!?,;:]$/.test(word.word.trim())) flush();
  }
  flush();

  // A cue never overlaps the next one.
  for (let i = 0; i < cues.length - 1; i++) {
    const room = cues[i + 1].from - cues[i].from;
    if (cues[i].durationInFrames > room && room > 0) cues[i].durationInFrames = room;
  }
  return cues;
}

/** Spreads words across a known duration by character count when a voice reports no timings. */
export function estimateWordTimings(text: string, durationSeconds: number): Word[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  const weights = tokens.map((token) => token.length + 2);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = 0;
  return tokens.map((word, index) => {
    const span = (weights[index] / total) * durationSeconds;
    const timed = { word, start: cursor, end: cursor + span };
    cursor += span;
    return timed;
  });
}

export type KeepRange = { start: number; end: number };

/** The parts of [start, end] to keep once pauses longer than maxGap are removed. */
export function trimSilence(words: Word[], start: number, end: number, maxGap = 0.7, padding = 0.12): KeepRange[] {
  const inside = words.filter((word) => word.end > start && word.start < end);
  if (inside.length === 0) return [{ start, end }];
  const ranges: KeepRange[] = [];
  let current: KeepRange = { start: Math.max(start, inside[0].start - padding), end: inside[0].end };
  for (const word of inside.slice(1)) {
    if (word.start - current.end > maxGap) {
      ranges.push({ ...current, end: current.end + padding });
      current = { start: word.start - padding, end: word.end };
    } else {
      current.end = word.end;
    }
  }
  ranges.push({ ...current, end: Math.min(end, current.end + padding) });
  return ranges;
}

export type ClipTimelineInput = {
  sourceAssetId: string;
  start: number;
  end: number;
  words: Word[];
  hook?: string | null;
  template: Template;
  brand: BrandStyle;
  focusX?: number;
  removeSilence?: boolean;
  music?: { assetId: string; durationSeconds: number | null } | null;
};

/** Mode 1: one cut of authorised source footage, reframed to 9:16 with captions. */
export function buildClipTimeline(input: ClipTimelineInput): TimelineSpec {
  const { start, end, words, template } = input;
  if (end <= start) throw new Error("Clip end must be after its start");
  const ranges = input.removeSilence === false ? [{ start, end }] : trimSilence(words, start, end);

  const visual: VisualClip[] = [];
  const retimed: Word[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    const durationInFrames = Math.max(secondsToFrames(range.end - range.start), 1);
    visual.push({
      id: `clip-${index}`,
      type: "video",
      assetId: input.sourceAssetId,
      from: cursor,
      durationInFrames,
      trimStartFrames: secondsToFrames(range.start),
      focusX: input.focusX ?? 0.5,
      volume: 1,
      transition: "cut",
      transitionFrames: 0,
      motion: "none",
      punch: false,
    });
    const offsetSeconds = cursor / TIMELINE_FPS - range.start;
    for (const word of words) {
      if (word.start >= range.start && word.end <= range.end) {
        retimed.push({ word: word.word, start: word.start + offsetSeconds, end: word.end + offsetSeconds });
      }
    }
    cursor += durationInFrames;
  });

  const text: TextOverlay[] =
    template.hookOverlay && input.hook
      ? [{ id: "hook", from: 0, durationInFrames: Math.min(75, cursor), text: input.hook, role: "kinetic" }]
      : [];

  return timelineSpecSchema.parse({
    version: 1,
    fps: TIMELINE_FPS,
    width: TIMELINE_WIDTH,
    height: TIMELINE_HEIGHT,
    durationInFrames: cursor,
    tracks: {
      visual,
      narration: [],
      music: musicTrack(input.music, cursor),
      captions: buildCaptionCues(retimed, template.maxWordsPerCue),
      text,
    },
    style: styleFor(template, input.brand, false),
  });
}

function musicTrack(music: ClipTimelineInput["music"], totalFrames: number) {
  if (!music) return [];
  const clipFrames = music.durationSeconds ? secondsToFrames(music.durationSeconds) : totalFrames;
  const clips = [];
  for (let from = 0, index = 0; from < totalFrames; from += clipFrames, index++) {
    clips.push({
      id: `music-${index}`,
      assetId: music.assetId,
      from,
      durationInFrames: Math.min(clipFrames, totalFrames - from),
      trimStartFrames: 0,
      volume: 0.12,
    });
  }
  return clips;
}

export type SceneInput = {
  id: string;
  narration: string;
  narrationAssetId: string;
  durationSeconds: number;
  words: Word[];
  visual:
    | { type: "video"; assetId: string; durationSeconds: number | null }
    | { type: "image"; assetId: string }
    | { type: "card" };
  speaker?: string | null;
  callout?: { value: string; label?: string } | null;
  levels?: number[];
};

export type FacelessTimelineInput = {
  scenes: SceneInput[];
  hook?: string | null;
  title?: string | null;
  template: Template;
  brand: BrandStyle;
  music?: { assetId: string; durationSeconds: number | null } | null;
};

const SCENE_TAIL_FRAMES = 6;

/** Mode 2: narration-led scenes. Footage shorter than its scene repeats rather than going black. */
export function buildFacelessTimeline(input: FacelessTimelineInput): TimelineSpec {
  const { scenes, template } = input;
  if (scenes.length === 0) throw new Error("A video needs at least one scene");

  const visual: VisualClip[] = [];
  const narration: TimelineSpec["tracks"]["narration"] = [];
  const captions: CaptionCue[] = [];
  const stats: TextOverlay[] = [];
  const speakerNames = [...new Set(scenes.map((scene) => scene.speaker).filter((name): name is string => Boolean(name)))];
  let cursor = 0;

  scenes.forEach((scene, sceneIndex) => {
    const narrationFrames = Math.max(secondsToFrames(scene.durationSeconds), 1);
    const sceneFrames = narrationFrames + SCENE_TAIL_FRAMES;
    const transition = sceneIndex === 0 ? "cut" : template.transition;
    const transitionFrames = sceneIndex === 0 ? 0 : template.transitionFrames;
    const speakerIndex = scene.speaker ? speakerNames.indexOf(scene.speaker) : undefined;
    const motion = template.motion ? (sceneIndex % 2 === 0 ? "push" : "pull") : "none";

    if (scene.callout) {
      stats.push({
        id: `${scene.id}-stat`,
        from: cursor + 8,
        durationInFrames: Math.max(Math.min(sceneFrames - 8, secondsToFrames(4)), 1),
        text: scene.callout.value,
        label: scene.callout.label,
        role: "stat",
        speakerIndex,
      });
    }

    if (scene.visual.type === "video") {
      const clipFrames = scene.visual.durationSeconds ? secondsToFrames(scene.visual.durationSeconds) : sceneFrames;
      for (let offset = 0, part = 0; offset < sceneFrames; offset += clipFrames, part++) {
        visual.push({
          id: `${scene.id}-v${part}`,
          sceneId: scene.id,
          type: "video",
          assetId: scene.visual.assetId,
          from: cursor + offset,
          durationInFrames: Math.min(clipFrames, sceneFrames - offset),
          trimStartFrames: 0,
          focusX: 0.5,
          volume: 0,
          transition: part === 0 ? transition : "cut",
          transitionFrames: part === 0 ? transitionFrames : 0,
          motion,
          punch: Boolean(template.motion) && part === 0 && sceneIndex > 0,
        });
      }
    } else {
      visual.push({
        id: `${scene.id}-v0`,
        sceneId: scene.id,
        type: scene.visual.type,
        assetId: scene.visual.type === "image" ? scene.visual.assetId : undefined,
        from: cursor,
        durationInFrames: sceneFrames,
        trimStartFrames: 0,
        focusX: 0.5,
        volume: 0,
        transition,
        transitionFrames,
        motion: scene.visual.type === "image" ? motion : "none",
        punch: Boolean(template.motion) && sceneIndex > 0,
      });
    }

    narration.push({
      id: `${scene.id}-a`,
      sceneId: scene.id,
      assetId: scene.narrationAssetId,
      from: cursor,
      durationInFrames: narrationFrames,
      trimStartFrames: 0,
      volume: 1,
      speakerIndex,
      levels: scene.levels,
    });

    captions.push(...buildCaptionCues(scene.words, template.maxWordsPerCue, cursor, `${scene.id}-c`).map((cue) => ({ ...cue, speakerIndex })));
    cursor += sceneFrames;
  });

  const hook: TextOverlay[] =
    template.hookOverlay && input.hook
      ? [{ id: "hook", from: 0, durationInFrames: Math.min(60, cursor), text: input.hook, role: "kinetic" }]
      : [];
  const text = [...hook, ...stats];
  const colors = [input.brand.brandPrimary, input.brand.brandSecondary];
  const podcast =
    template.id === "podcast"
      ? {
          title: input.title ?? undefined,
          speakers: (speakerNames.length > 0 ? speakerNames : ["Host"]).map((name, index) => ({ name, color: colors[index % colors.length] })),
        }
      : undefined;

  return timelineSpecSchema.parse({
    version: 1,
    fps: TIMELINE_FPS,
    width: TIMELINE_WIDTH,
    height: TIMELINE_HEIGHT,
    durationInFrames: cursor,
    tracks: { visual, narration, music: musicTrack(input.music, cursor), captions, text },
    style: { ...styleFor(template, input.brand, true), podcast },
  });
}

/** Splits free text into scenes of one or two sentences, sized for short-form pacing. */
export function splitIntoScenes(body: string, maxWords = 24): string[] {
  const sentences = body
    .replace(/\s+/g, " ")
    .trim()
    .match(/[^.!?]+[.!?]*["')\]]*\s*/g)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean);
  if (!sentences) return [];
  const scenes: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const combined = current ? `${current} ${sentence}` : sentence;
    if (current && combined.split(" ").length > maxWords) {
      scenes.push(current);
      current = sentence;
    } else {
      current = combined;
    }
  }
  if (current) scenes.push(current);
  return scenes;
}

export type ParsedScene = { narration: string; visualQuery: string; speaker?: string; callout?: { value: string; label?: string } };

const SPEAKER_LINE = /^\s*([A-Z][\w'-]{0,19}(?: [A-Z][\w'-]{0,19})?):\s+(.*)$/;

/**
 * Scenes from a pasted script. "Bees make honey. [bees honeycomb]" makes that text one scene with
 * those footage search words, and "[bees honeycomb | 18% | water left]" adds a big on-screen stat.
 * Text with no brackets is split and gets guessed keywords. Lines starting "Maya:" name a host, but
 * only when at least two names appear, so a stray "Note:" in a normal script stays narration.
 */
export function parseScriptScenes(body: string): ParsedScene[] {
  const lines = body.split("\n").map((line) => line.match(SPEAKER_LINE));
  const names = new Set(lines.flatMap((match) => (match ? [match[1]] : [])));
  if (names.size < 2) return parseSceneText(body);

  let speaker: string | undefined;
  return body.split("\n").flatMap((line, index) => {
    const match = lines[index];
    if (match) speaker = match[1];
    return parseSceneText(match ? match[2] : line).map((scene) => ({ ...scene, speaker }));
  });
}

function parseSceneText(body: string): ParsedScene[] {
  const parts = body.split(/\[([^\]]*)\]/);
  return parts.flatMap((part, index) => {
    if (index % 2 === 1) return [];
    const narration = part.replace(/\s+/g, " ").trim();
    const [query, value, label] = (parts[index + 1] ?? "").split("|").map((piece) => piece.replace(/\s+/g, " ").trim());
    const callout = value ? { value, ...(label ? { label } : {}) } : undefined;
    if (narration && (query || callout)) return [{ narration, visualQuery: query || keywordsFromText(narration), ...(callout ? { callout } : {}) }];
    return splitIntoScenes(narration).map((scene) => ({ narration: scene, visualQuery: keywordsFromText(scene) }));
  });
}

const STOP_WORDS = new Set(
  "a an and are as at be been but by can could did do does for from had has have he her his how i if in into is it its just like more most no not of on one or our out she so some than that the their them then there these they this to up us was we were what when where which who why will with would you your".split(
    " ",
  ),
);

/** Stock search terms for a scene when no LLM is available to write them. */
export function keywordsFromText(text: string, limit = 3): string {
  const counts = new Map<string, number>();
  for (const raw of text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []) {
    if (!STOP_WORDS.has(raw)) counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, limit)
    .map(([word]) => word)
    .join(" ");
}
