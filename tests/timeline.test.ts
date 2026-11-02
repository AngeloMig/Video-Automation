import { describe, expect, it, vi } from "vitest";
import { parseIsoDuration, parseYoutubeId, pixabayStock } from "../src/services/discovery";
import { chunkNarration, encodeWav, parseSayVoices, wordsFromAlignment } from "../src/services/tts";
import { engagementScore, normalizeHighlights, scoreVideo } from "../src/pipelines/scoring";
import { runQaChecks } from "../src/pipelines/production";
import { backoffSeconds } from "../src/jobs/queue";
import { levelsFromSamples } from "../src/media/ffmpeg";
import { buildCaptionCues, buildClipTimeline, buildFacelessTimeline, estimateWordTimings, getTemplate, keywordsFromText, parseScriptScenes, pickSpeakerVoice, splitIntoScenes, trimSilence } from "../src/timeline/build";
import { deleteVisual, moveScene, removeRange, replaceVisualAsset, sceneBlocks, splitVisualAt, trimVisual, updateCaptionText } from "../src/timeline/edit";
import { collectAssetIds, timelineSpecSchema } from "../src/timeline/spec";

describe("provider parsing", () => {
  it("keeps the whole name of macOS voices, with one or several spaces before the locale", () => {
    const output = ["Samantha            en_US    # Hello!", "Eddy (English (US)) en_US    # Hello!", "Amelie              fr_CA    # Bonjour!", ""].join("\n");
    expect(parseSayVoices(output)).toEqual(["Samantha", "Eddy (English (US))"]);
  });

  it("writes Kokoro samples as a valid mono WAV and clamps out-of-range values", () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2]), 24000);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt32LE(40)).toBe(8);
    expect([44, 46, 48, 50].map((offset) => wav.readInt16LE(offset))).toEqual([0, 32767, -32767, 32767]);
  });

  it("splits long narration without losing words or going over the limit", () => {
    expect(chunkNarration("Short line. Another one!")).toEqual(["Short line. Another one!"]);
    const sentences = Array.from({ length: 12 }, (_, i) => `Sentence ${i} has a few more words in it than the last one did.`).join(" ");
    const noPunctuation = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");
    for (const text of [sentences, noPunctuation]) {
      const chunks = chunkNarration(text);
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.every((chunk) => chunk.length <= 300)).toBe(true);
      expect(chunks.join(" ")).toBe(text);
    }
    expect(chunkNarration("   ")).toEqual([]);
  });

  it("uses bracketed footage words as scenes and keeps them out of the narration", () => {
    expect(parseScriptScenes("Bees make honey. [bees  honeycomb]\nIt lasts a long time, sealed. [ honey jar ]")).toEqual([
      { narration: "Bees make honey.", visualQuery: "bees honeycomb" },
      { narration: "It lasts a long time, sealed.", visualQuery: "honey jar" },
    ]);
    const unmarked = parseScriptScenes("Bees make honey in the hive.");
    expect(unmarked).toEqual([{ narration: "Bees make honey in the hive.", visualQuery: keywordsFromText("Bees make honey in the hive.") }]);
    const tail = parseScriptScenes("First line. [first words] A last line with no words.");
    expect(tail.map((scene) => scene.narration)).toEqual(["First line.", "A last line with no words."]);
    expect(parseScriptScenes("Empty brackets here. []")[0].visualQuery).toBe(keywordsFromText("Empty brackets here."));
    expect(parseScriptScenes(" [only words] ")).toEqual([]);
  });

  it("reads podcast scripts: hosts, stats, and multi-sentence turns", () => {
    const scenes = parseScriptScenes(`Maya: Bees dry nectar. [bees honeycomb | 18% | water left]

Theo: Wait, really? It lasts that long? [honey jar]
Maya: It does. It keeps going. And going.`);
    expect(scenes[0]).toEqual({ narration: "Bees dry nectar.", visualQuery: "bees honeycomb", speaker: "Maya", callout: { value: "18%", label: "water left" } });
    expect(scenes[1]).toMatchObject({ narration: "Wait, really? It lasts that long?", visualQuery: "honey jar", speaker: "Theo" });
    expect(scenes.slice(2).every((scene) => scene.speaker === "Maya")).toBe(true);
    expect(scenes.slice(2).map((scene) => scene.narration).join(" ")).toBe("It does. It keeps going. And going.");
  });

  it("treats one label as narration, so a stray Note: isn't a host", () => {
    const scenes = parseScriptScenes("Note: honey lasts a long time. [honey jar]\nIt stays good when sealed. [jar lid]");
    expect(scenes.every((scene) => scene.speaker === undefined)).toBe(true);
    expect(scenes[0].narration).toBe("Note: honey lasts a long time.");
  });

  it("gives hosts different voices, contrasting when genders are labelled", () => {
    const voices = [
      { id: "a", label: "Heart (American, female)" },
      { id: "b", label: "Bella (American, female)" },
      { id: "c", label: "Michael (American, male)" },
    ];
    expect(pickSpeakerVoice(voices, 0)).toBe("a");
    expect(pickSpeakerVoice(voices, 1)).toBe("c");
    expect(pickSpeakerVoice(voices, 0, "c")).toBe("c");
    expect(pickSpeakerVoice(voices, 1, "c")).toBe("a");
    expect(pickSpeakerVoice([{ id: "x", label: "Rachel" }, { id: "y", label: "Adam" }], 1, "x")).toBe("y");
    expect(pickSpeakerVoice([], 1)).toBeUndefined();
  });

  it("measures loudness per block relative to the loudest, and handles silence", () => {
    expect(levelsFromSamples([0.5, 0.5, 0.25, 0.25, 0, 0], 2)).toEqual([1, 0.5, 0]);
    expect(levelsFromSamples([0, 0, 0], 2)).toEqual([0, 0]);
    expect(levelsFromSamples([], 2)).toEqual([]);
  });

  it("builds a podcast timeline with each host's voice, captions, waveform levels and stat", () => {
    const scene = (id: string, speaker: string, callout?: { value: string; label?: string }) => ({
      id,
      narration: "Bees dry the nectar down.",
      narrationAssetId: `${id}-audio`,
      durationSeconds: 2,
      words: estimateWordTimings("Bees dry the nectar down.", 2),
      visual: { type: "video" as const, assetId: `${id}-video`, durationSeconds: 10 },
      speaker,
      callout,
      levels: [0.2, 0.8],
    });
    const spec = buildFacelessTimeline({
      scenes: [scene("one", "Maya"), scene("two", "Theo", { value: "18%", label: "water left" })],
      title: "Honey",
      template: getTemplate("podcast"),
      brand: { brandPrimary: "#111111", brandSecondary: "#222222" },
    });
    expect(spec.style.podcast).toEqual({ title: "Honey", speakers: [{ name: "Maya", color: "#111111" }, { name: "Theo", color: "#222222" }] });
    expect(spec.tracks.narration.map((clip) => clip.speakerIndex)).toEqual([0, 1]);
    expect(spec.tracks.narration[1].levels).toEqual([0.2, 0.8]);
    expect(spec.tracks.captions.at(-1)?.speakerIndex).toBe(1);
    expect(spec.tracks.text).toHaveLength(1);
    expect(spec.tracks.text[0]).toMatchObject({ role: "stat", text: "18%", label: "water left", speakerIndex: 1 });
    expect(spec.tracks.text[0].from).toBeGreaterThanOrEqual(spec.tracks.narration[1].from);
    expect(spec.tracks.visual.map((clip) => clip.motion)).toEqual(["push", "pull"]);
    expect(spec.tracks.visual.map((clip) => clip.punch)).toEqual([false, true]);
    // Moving a scene takes its stat with it.
    const moved = moveScene(spec, "two", -1);
    expect(moved.tracks.text[0].from).toBeLessThan(spec.tracks.text[0].from);
  });

  it("reads Pixabay hits, ranks by matching tags, picks a fast rendition, skips small ones and caches the search", async () => {
    const hits = [
      { id: 1, pageURL: "https://pixabay.test/1", duration: 9, user: "Ana", tags: "bees, garden", videos: { large: { url: "", width: 0, height: 0 }, medium: { url: "https://cdn.test/1.mp4", width: 1280, height: 720 } } },
      { id: 2, pageURL: "https://pixabay.test/2", duration: 7, tags: "honey, bees", videos: { large: { url: "https://cdn.test/2k.mp4", width: 3840, height: 2160 }, medium: { url: "https://cdn.test/2.mp4", width: 1920, height: 1080 }, tiny: { url: "https://cdn.test/2t.mp4", width: 360, height: 640 } } },
      { id: 3, pageURL: "https://pixabay.test/3", duration: 5, videos: { tiny: { url: "https://cdn.test/3.mp4", width: 360, height: 640 } } },
    ];
    const fetchStub = vi.fn(async () => new Response(JSON.stringify({ hits })));
    vi.stubGlobal("fetch", fetchStub);
    try {
      const clips = await pixabayStock.search("honey bees");
      expect(clips.map((clip) => clip.externalId)).toEqual(["2", "1"]);
      expect(clips[0]).toMatchObject({ downloadUrl: "https://cdn.test/2.mp4", license: "Pixabay Content License", attribution: "Video from Pixabay" });
      expect(clips[1]).toMatchObject({ downloadUrl: "https://cdn.test/1.mp4", attribution: "Video by Ana on Pixabay" });
      await pixabayStock.search("honey bees");
      expect(fetchStub).toHaveBeenCalledTimes(1);
      expect(String((fetchStub.mock.calls as unknown as [string][])[0][0])).toContain("video_type=film");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

const brand = { brandPrimary: "#58D5C9", brandSecondary: "#77A9FF" };
const words = (text: string, start = 0, step = 0.5) => text.split(" ").map((word, i) => ({ word, start: start + i * step, end: start + i * step + step * 0.8 }));

function facelessSpec() {
  return buildFacelessTimeline({
    template: getTemplate("signal"),
    brand,
    hook: "Hook",
    scenes: [
      { id: "a", narration: "one two", narrationAssetId: "na", durationSeconds: 2, words: words("one two"), visual: { type: "card" } },
      { id: "b", narration: "three four", narrationAssetId: "nb", durationSeconds: 2, words: words("three four"), visual: { type: "video", assetId: "vb", durationSeconds: 1 } },
      { id: "c", narration: "five six", narrationAssetId: "nc", durationSeconds: 2, words: words("five six"), visual: { type: "image", assetId: "ic" } },
    ],
  });
}

describe("timeline builders", () => {
  it("builds a valid vertical spec", () => {
    const spec = facelessSpec();
    expect(() => timelineSpecSchema.parse(spec)).not.toThrow();
    expect([spec.width, spec.height, spec.fps]).toEqual([1080, 1920, 30]);
    expect(spec.durationInFrames).toBe(3 * (60 + 6));
  });

  it("repeats footage shorter than its scene instead of going black", () => {
    const clips = facelessSpec().tracks.visual.filter((clip) => clip.sceneId === "b");
    expect(clips.length).toBe(3);
    expect(clips.reduce((sum, clip) => sum + clip.durationInFrames, 0)).toBe(66);
    expect(clips[1].from).toBe(clips[0].from + clips[0].durationInFrames);
  });

  it("collects each drawn asset once", () => {
    expect(collectAssetIds(facelessSpec()).sort()).toEqual(["ic", "na", "nb", "nc", "vb"]);
  });

  it("breaks captions at punctuation, word limits and pauses, without overlap", () => {
    const cues = buildCaptionCues(
      [
        { word: "Hello,", start: 0, end: 0.3 },
        { word: "this", start: 0.35, end: 0.5 },
        { word: "is", start: 0.5, end: 0.6 },
        { word: "split", start: 2, end: 2.3 },
      ],
      4,
    );
    expect(cues.map((cue) => cue.text)).toEqual(["Hello,", "this is", "split"]);
    for (let i = 1; i < cues.length; i++) expect(cues[i - 1].from + cues[i - 1].durationInFrames).toBeLessThanOrEqual(cues[i].from);
  });

  it("spreads estimated timings across exactly the narration length", () => {
    const timed = estimateWordTimings("a longer sentence here", 4);
    expect(timed).toHaveLength(4);
    expect(timed[0].start).toBe(0);
    expect(timed[3].end).toBeCloseTo(4);
    expect(timed[1].end - timed[1].start).toBeGreaterThan(timed[0].end - timed[0].start);
  });

  it("removes long pauses and retimes captions to match", () => {
    const transcript = [
      { word: "before", start: 1, end: 1.5 },
      { word: "after", start: 5, end: 5.5 },
    ];
    expect(trimSilence(transcript, 0, 6)).toHaveLength(2);
    const spec = buildClipTimeline({ sourceAssetId: "src", start: 0, end: 6, words: transcript, template: getTemplate("signal"), brand });
    expect(spec.tracks.visual).toHaveLength(2);
    expect(spec.durationInFrames).toBeLessThan(90);
    expect(spec.tracks.visual[1].trimStartFrames).toBeGreaterThan(spec.tracks.visual[0].trimStartFrames);
    const lastCue = spec.tracks.captions[spec.tracks.captions.length - 1];
    // Once the pause is gone the two words may share a cue, but "after" must land in the second cut.
    const after = lastCue.words[lastCue.words.length - 1];
    expect(after.text).toBe("after");
    expect(lastCue.from + after.from).toBeGreaterThanOrEqual(spec.tracks.visual[1].from);
  });

  it("marks only synthetic-voice videos for disclosure", () => {
    expect(facelessSpec().style.syntheticMediaDisclosure).toBe(true);
    const clip = buildClipTimeline({ sourceAssetId: "src", start: 0, end: 5, words: [], template: getTemplate("signal"), brand });
    expect(clip.style.syntheticMediaDisclosure).toBe(false);
  });

  it("splits scripts into scenes and finds search keywords", () => {
    const scenes = splitIntoScenes("Mars is red. It has a huge volcano called Olympus Mons that towers over everything nearby on the planet. Water once flowed there!", 10);
    expect(scenes.length).toBeGreaterThanOrEqual(2);
    expect(scenes.join(" ")).toContain("Water once flowed there!");
    expect(keywordsFromText("The volcano on the planet is a volcano")).toContain("volcano");
    expect(splitIntoScenes("   ")).toEqual([]);
  });
});

describe("editor operations", () => {
  it("ripple deletes across tracks and shortens the video", () => {
    const spec = facelessSpec();
    const edited = deleteVisual(spec, "a-v0");
    expect(edited.durationInFrames).toBe(spec.durationInFrames - 66);
    expect(edited.tracks.visual[0].sceneId).toBe("b");
    expect(edited.tracks.visual[0].from).toBe(0);
    expect(edited.tracks.narration.map((clip) => clip.sceneId)).toEqual(["b", "c"]);
    expect(() => timelineSpecSchema.parse(edited)).not.toThrow();
  });

  it("advances source and audio position when trimming a clip's head", () => {
    const spec = facelessSpec();
    const edited = trimVisual(spec, "c-v0", "start", 10);
    const narration = edited.tracks.narration.find((clip) => clip.sceneId === "c")!;
    expect(narration.trimStartFrames).toBe(10);
    expect(edited.durationInFrames).toBe(spec.durationInFrames - 10);
  });

  it("never trims a clip to nothing", () => {
    const spec = facelessSpec();
    const edited = trimVisual(spec, "a-v0", "end", 9999);
    expect(edited.tracks.visual.find((clip) => clip.id === "a-v0")?.durationInFrames).toBe(1);
  });

  it("refuses to leave an empty video", () => {
    const spec = facelessSpec();
    expect(() => removeRange(spec, 0, spec.durationInFrames)).toThrow();
  });

  it("splits a clip with continuous source timing", () => {
    const edited = splitVisualAt(facelessSpec(), 30);
    const [head, tail] = edited.tracks.visual;
    expect(head.durationInFrames + tail.durationInFrames).toBe(66);
    expect(tail.from).toBe(30);
    expect(tail.trimStartFrames).toBe(30);
    expect(splitVisualAt(edited, 30)).toBe(edited);
  });

  it("moves a scene with its narration and captions", () => {
    const spec = facelessSpec();
    const edited = moveScene(spec, "c", -1);
    expect(sceneBlocks(edited).map((block) => block.key)).toEqual(["a", "c", "b"]);
    expect(edited.durationInFrames).toBe(spec.durationInFrames);
    const narrationC = edited.tracks.narration.find((clip) => clip.sceneId === "c")!;
    const visualC = edited.tracks.visual.find((clip) => clip.sceneId === "c")!;
    expect(narrationC.from).toBe(visualC.from);
    const cueIds = edited.tracks.captions.filter((cue) => cue.from >= visualC.from && cue.from < visualC.from + 66).map((cue) => cue.id);
    expect(cueIds.every((id) => id.startsWith("c-"))).toBe(true);
    expect(moveScene(spec, "a", -1)).toBe(spec);
  });

  it("swaps footage and rewrites caption text", () => {
    let spec = replaceVisualAsset(facelessSpec(), "a-v0", { id: "new", kind: "video" });
    expect(spec.tracks.visual[0]).toMatchObject({ type: "video", assetId: "new" });
    const cue = spec.tracks.captions[0];
    spec = updateCaptionText(spec, cue.id, "brand new words");
    expect(spec.tracks.captions[0].words.map((w) => w.text)).toEqual(["brand", "new", "words"]);
  });
});

describe("scoring", () => {
  const metrics = { title: "Mars volcano facts", publishedAt: new Date().toISOString(), viewCount: 1000, likeCount: 50, commentCount: 5 };
  const ai = { relevance: 90, hook: 80, educational: 70, storytelling: 60, shortForm: 85, reason: "Fits." };

  it("scores 0 to 100 with every factor explained", () => {
    const result = scoreVideo(metrics, [], ai);
    expect(result.complete).toBe(true);
    expect(result.total).toBeGreaterThan(0);
    expect(result.total).toBeLessThanOrEqual(100);
    expect(result.factors.every((factor) => factor.reason.length > 0)).toBe(true);
  });

  it("marks a score partial without AI and leaves those factors unscored", () => {
    const result = scoreVideo(metrics, [], null);
    expect(result.complete).toBe(false);
    expect(result.factors.find((factor) => factor.key === "relevance")?.score).toBeNull();
    expect(result.total).toBeGreaterThan(0);
  });

  it("treats hidden counts as unknown, not zero", () => {
    expect(engagementScore({ viewCount: 500, likeCount: null, commentCount: null })).toBeNull();
    expect(engagementScore({ viewCount: 0, likeCount: 0, commentCount: 0 })).toBeNull();
  });

  it("scores repeated topics lower", () => {
    const fresh = scoreVideo(metrics, [], ai).factors.find((f) => f.key === "novelty")!.score!;
    const repeat = scoreVideo(metrics, ["Mars volcano facts"], ai).factors.find((f) => f.key === "novelty")!.score!;
    expect(repeat).toBeLessThan(fresh);
  });

  const segments = [
    { start: 0, end: 10 },
    { start: 10, end: 20 },
    { start: 20, end: 30 },
    { start: 30, end: 40 },
  ];
  const limits = { minSeconds: 10, maxSeconds: 25, sourceSeconds: 40 };
  const base = { title: "t", hook: "h", reason: "r" };

  it("keeps highlights inside limits and sentence boundaries", () => {
    const [clip] = normalizeHighlights([{ ...base, start: 1, end: 39, score: 80 }], segments, limits);
    expect(clip.start).toBe(0);
    expect(clip.end).toBe(20);
  });

  it("drops the lower-scored of two overlapping highlights", () => {
    const result = normalizeHighlights(
      [
        { ...base, start: 0, end: 20, score: 40 },
        { ...base, start: 10, end: 30, score: 90 },
      ],
      segments,
      limits,
    );
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(90);
  });

  it("ignores impossible model output", () => {
    expect(normalizeHighlights([{ ...base, start: 20, end: 5, score: 100 }, { ...base, start: Number.NaN, end: 5, score: 100 }], segments, limits)).toEqual([]);
  });
});

describe("quality checks", () => {
  const spec = facelessSpec();
  const seconds = spec.durationInFrames / 30;
  const good = { durationSeconds: seconds, width: 1080, height: 1920, hasVideo: true, hasAudio: true };
  const blockingFailures = (checks: ReturnType<typeof runQaChecks>) => checks.filter((c) => !c.passed && c.blocking).map((c) => c.key);

  it("passes a correct file", () => {
    expect(blockingFailures(runQaChecks(spec, good, -18))).toEqual([]);
  });
  it("blocks wrong dimensions, wrong duration and missing audio", () => {
    expect(blockingFailures(runQaChecks(spec, { ...good, width: 720 }, -18))).toContain("dimensions");
    expect(blockingFailures(runQaChecks(spec, { ...good, durationSeconds: seconds + 2 }, -18))).toContain("duration");
    expect(blockingFailures(runQaChecks(spec, { ...good, hasAudio: false }, -18))).toContain("audio");
  });
  it("blocks silent narration, but only warns on a silent clip", () => {
    expect(blockingFailures(runQaChecks(spec, good, Number.NEGATIVE_INFINITY))).toContain("loudness");
    const clip = buildClipTimeline({ sourceAssetId: "s", start: 0, end: 5, words: [], template: getTemplate("signal"), brand });
    const checks = runQaChecks(clip, { ...good, durationSeconds: 5 }, Number.NEGATIVE_INFINITY);
    expect(blockingFailures(checks)).toEqual([]);
    expect(checks.find((c) => c.key === "loudness")?.passed).toBe(false);
  });
});

describe("adapters and queue helpers", () => {
  it("parses YouTube links", () => {
    for (const url of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ?t=3", "https://youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"]) {
      expect(parseYoutubeId(url)).toBe("dQw4w9WgXcQ");
    }
    expect(parseYoutubeId("https://evil.test/watch?v=dQw4w9WgXcQ")).toBeNull();
  });
  it("parses ISO durations", () => {
    expect(parseIsoDuration("PT1H2M3S")).toBe(3723);
    expect(parseIsoDuration("PT45S")).toBe(45);
    expect(parseIsoDuration("P0D")).toBeNull();
  });
  it("rebuilds words from character timings", () => {
    const result = wordsFromAlignment({
      characters: ["H", "i", " ", "y", "o"],
      character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4],
      character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5],
    });
    expect(result).toEqual([
      { word: "Hi", start: 0, end: 0.2 },
      { word: "yo", start: 0.3, end: 0.5 },
    ]);
  });
  it("backs off exponentially, with jitter and a ceiling", () => {
    const fixed = () => 0.5;
    expect(backoffSeconds(1, fixed)).toBe(15);
    expect(backoffSeconds(2, fixed)).toBe(30);
    expect(backoffSeconds(3, fixed)).toBe(60);
    expect(backoffSeconds(20, fixed)).toBe(900);
  });
});
