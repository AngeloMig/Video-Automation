import type { CSSProperties } from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont } from "@remotion/google-fonts/BricolageGrotesque";
import { RunnerGame } from "./RunnerGame";
import type { CaptionCue, TextOverlay, TimelineProps, VisualClip } from "../timeline/spec";

/**
 * Draws a TimelineSpec. The editor's Player and the worker's renderer both mount this component,
 * so anything visual belongs here and uses inline styles rather than app CSS.
 */
export function Timeline({ spec, assetUrls }: TimelineProps) {
  const { tracks, style } = spec;
  const watermark = style.watermarkAssetId ? assetUrls[style.watermarkAssetId] : undefined;
  const podcast = style.podcast;
  const colorFor = (speakerIndex?: number) => podcast?.speakers[speakerIndex ?? 0]?.color ?? style.brandPrimary;
  const runner = style.template === "runner";
  return (
    <AbsoluteFill style={{ backgroundColor: "#0B111B" }}>
      {/* The split-screen format keeps footage to the top half, above the runner animation. */}
      <AbsoluteFill style={runner ? { height: "50%", overflow: "hidden" } : undefined}>
        {tracks.visual.map((clip) => (
          <Sequence key={clip.id} from={clip.from} durationInFrames={clip.durationInFrames} layout="none">
            <VisualLayer clip={clip} url={clip.assetId ? assetUrls[clip.assetId] : undefined} spec={spec} />
          </Sequence>
        ))}
      </AbsoluteFill>

      {runner ? <RunnerGame fontFamily={impactFont()} /> : null}
      {podcast ? <PodcastGrade /> : null}

      {[...tracks.narration, ...tracks.music].map((clip) =>
        assetUrls[clip.assetId] ? (
          <Sequence key={clip.id} from={clip.from} durationInFrames={clip.durationInFrames} layout="none">
            <Audio src={assetUrls[clip.assetId]} trimBefore={clip.trimStartFrames || undefined} volume={clip.volume} />
          </Sequence>
        ) : null,
      )}

      {tracks.text.map((overlay) => (
        <Sequence key={overlay.id} from={overlay.from} durationInFrames={overlay.durationInFrames} layout="none">
          {overlay.role === "stat" ? <StatPop overlay={overlay} color={colorFor(overlay.speakerIndex)} /> : <KineticText overlay={overlay} color={style.brandPrimary} />}
        </Sequence>
      ))}

      {tracks.captions.map((cue) => (
        <Sequence key={cue.id} from={cue.from} durationInFrames={cue.durationInFrames} layout="none">
          {runner ? (
            <RunnerCaption cue={cue} captionStyle={style.caption} />
          ) : podcast ? (
            <PodcastCaption cue={cue} captionStyle={style.caption} color={colorFor(cue.speakerIndex)} name={podcast.speakers[cue.speakerIndex ?? 0]?.name} />
          ) : (
            <Caption cue={cue} captionStyle={style.caption} />
          )}
        </Sequence>
      ))}

      {podcast ? <PodcastDeck spec={spec} /> : null}

      {watermark ? (
        <Img src={watermark} style={{ position: "absolute", top: 110, right: 70, width: 150, height: 150, objectFit: "contain", opacity: 0.85 }} />
      ) : null}

      {style.syntheticMediaDisclosure ? (
        <div style={{ position: "absolute", top: 120, left: 70, fontFamily: FONT, fontSize: 26, color: "rgba(245,247,250,.72)", letterSpacing: 0.4 }}>
          {(podcast?.speakers.length ?? 0) > 1 ? "AI-generated voices" : "AI-generated voice"}
        </div>
      ) : null}
    </AbsoluteFill>
  );
}

const FONT = "Inter, Helvetica, Arial, sans-serif";

function VisualLayer({ clip, url, spec }: { clip: VisualClip; url?: string; spec: TimelineProps["spec"] }) {
  const frame = useCurrentFrame();
  const opacity =
    clip.transition === "fade" && clip.transitionFrames > 0
      ? interpolate(frame, [0, clip.transitionFrames], [0, 1], { extrapolateRight: "clamp" })
      : 1;
  const fill: CSSProperties = { width: "100%", height: "100%", objectFit: "cover", objectPosition: `${clip.focusX * 100}% 50%` };
  const punch = clip.punch ? interpolate(frame, [0, 9], [1, 0], { extrapolateRight: "clamp" }) : 0;

  if (clip.type === "card" || !url) {
    return (
      <AbsoluteFill style={{ opacity }}>
        <TypographicCard color={spec.style.brandPrimary} secondary={spec.style.brandSecondary} seed={clip.from} text={clip.cardText} />
        <AbsoluteFill style={{ backgroundColor: "#FFFFFF", opacity: punch * 0.28 }} />
      </AbsoluteFill>
    );
  }
  const progress = interpolate(frame, [0, Math.max(clip.durationInFrames, 1)], [0, 1], { extrapolateRight: "clamp" });
  const drift = clip.motion === "push" ? 1.03 + progress * 0.11 : clip.motion === "pull" ? 1.14 - progress * 0.11 : 1;
  return (
    <AbsoluteFill style={{ opacity, overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `scale(${drift + punch * 0.09})` }}>
        {clip.type === "image" ? (
          <Img src={url} style={fill} />
        ) : (
          <OffthreadVideo src={url} trimBefore={clip.trimStartFrames || undefined} volume={clip.volume} style={fill} />
        )}
      </AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: "#FFFFFF", opacity: punch * 0.28 }} />
    </AbsoluteFill>
  );
}

/** A big number that lands with a bounce, then clears before the next scene. */
function StatPop({ overlay, color }: { overlay: TextOverlay; color: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fontFamily = displayFont();
  const enter = spring({ frame, fps, config: { damping: 11, stiffness: 170, mass: 0.7 } });
  const exit = interpolate(frame, [overlay.durationInFrames - 7, overlay.durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const label = interpolate(frame, [8, 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  // Long values shrink so they still fit left of the app's on-screen buttons.
  const fontSize = Math.min(290, Math.round(1300 / Math.max(overlay.text.length, 1)));
  return (
    <div style={{ position: "absolute", top: 300, left: 64, right: 150, opacity: exit }}>
      <div
        style={{
          fontFamily,
          fontWeight: 800,
          fontSize,
          lineHeight: 0.95,
          letterSpacing: -6,
          color,
          transform: `scale(${enter}) rotate(${(1 - enter) * -5}deg)`,
          transformOrigin: "left bottom",
          textShadow: "0 10px 50px rgba(0,0,0,.65)",
        }}
      >
        {overlay.text}
      </div>
      {overlay.label ? (
        <div style={{ fontFamily, fontWeight: 700, fontSize: 50, lineHeight: 1.12, color: "#F5F7FA", marginTop: 16, opacity: label, transform: `translateY(${(1 - label) * 16}px)`, textShadow: "0 3px 24px rgba(0,0,0,.8)" }}>
          {overlay.label}
        </div>
      ) : null}
    </div>
  );
}

let podcastFont: string | undefined;
/** Loaded on first use, so other templates never depend on reaching Google Fonts. */
function displayFont() {
  podcastFont ??= loadFont("normal", { weights: ["700", "800"], subsets: ["latin"] }).fontFamily;
  return podcastFont;
}

let runnerFont: string | undefined;
function impactFont() {
  runnerFont ??= loadAnton("normal", { weights: ["400"], subsets: ["latin"] }).fontFamily;
  return runnerFont;
}

/** Oversized captions on the seam of the split screen. Each cue slams in. */
function RunnerCaption({ cue, captionStyle }: { cue: CaptionCue; captionStyle: TimelineProps["spec"]["style"]["caption"] }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 10, stiffness: 300, mass: 0.45 } });
  const words = cue.words.length > 0 ? cue.words : [{ text: cue.text, from: 0, to: cue.durationInFrames }];
  return (
    <div style={{ position: "absolute", top: 960, left: 50, right: 50, display: "flex", justifyContent: "center", transform: "translateY(-50%)" }}>
      <div
        style={{
          fontFamily: impactFont(),
          fontSize: captionStyle.fontSize,
          lineHeight: 1.04,
          textAlign: "center",
          textTransform: "uppercase",
          color: captionStyle.textColor,
          WebkitTextStroke: "16px #000000",
          paintOrder: "stroke fill",
          transform: `scale(${0.7 + enter * 0.3})`,
        }}
      >
        {words.map((word, index) => (
          <span key={index} style={{ color: frame >= word.from && frame < word.to ? captionStyle.highlightColor : undefined }}>
            {word.text}
            {index < words.length - 1 ? " " : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Darkens the top and lower middle so footage never fights the type. */
function PodcastGrade() {
  return (
    <AbsoluteFill
      style={{
        backgroundImage:
          "linear-gradient(180deg, rgba(5,8,14,.78) 0%, rgba(5,8,14,.05) 20%, rgba(5,8,14,0) 40%, rgba(5,8,14,.68) 62%, rgba(5,8,14,.9) 80%, rgba(5,8,14,.92) 100%)",
      }}
    />
  );
}

function PodcastCaption({ cue, captionStyle, color, name }: { cue: CaptionCue; captionStyle: TimelineProps["spec"]["style"]["caption"]; color: string; name?: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fontFamily = displayFont();
  const enter = spring({ frame, fps, config: { damping: 16, stiffness: 240, mass: 0.5 } });
  const words = cue.words.length > 0 ? cue.words : [{ text: cue.text, from: 0, to: cue.durationInFrames }];
  return (
    <div style={{ position: "absolute", top: `${captionStyle.positionY * 100}%`, left: 64, right: 150, height: 390, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      {name ? <div style={{ fontFamily, fontWeight: 800, fontSize: 38, letterSpacing: 3, color, textTransform: "uppercase", marginBottom: 12 }}>{name}</div> : null}
      <div
        style={{
          fontFamily,
          fontSize: captionStyle.fontSize,
          fontWeight: 800,
          lineHeight: 1.02,
          letterSpacing: -1.5,
          color: captionStyle.textColor,
          opacity: enter,
          transform: `translateY(${(1 - enter) * 22}px)`,
          textShadow: "0 4px 26px rgba(0,0,0,.75)",
        }}
      >
        {words.map((word, index) => (
          <span key={index} style={{ color: frame >= word.from && frame < word.to ? color : undefined }}>
            {word.text}
            {index < words.length - 1 ? " " : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

const WAVE_BARS = 34;

/**
 * The strip under the captions: host tags, a waveform drawn from the measured loudness of the
 * voice on air, and progress through the episode. It stops short of the right edge, where
 * Reels and Shorts draw their buttons.
 */
function PodcastDeck({ spec }: { spec: TimelineProps["spec"] }) {
  const frame = useCurrentFrame();
  const fontFamily = displayFont();
  const podcast = spec.style.podcast!;
  const narration = spec.tracks.narration;
  const onAir = narration.find((clip) => frame >= clip.from && frame < clip.from + clip.durationInFrames);
  const latest = onAir ?? [...narration].reverse().find((clip) => clip.from <= frame);
  const speaker = latest?.speakerIndex ?? 0;
  const color = podcast.speakers[speaker]?.color ?? spec.style.brandPrimary;
  const levelAt = (back: number) => {
    if (!onAir?.levels) return 0;
    return onAir.levels[frame - back - onAir.from + onAir.trimStartFrames] ?? 0;
  };
  const progress = Math.min(frame / Math.max(spec.durationInFrames - 1, 1), 1);
  return (
    <>
      {podcast.title ? (
        <div style={{ position: "absolute", top: 172, left: 70, right: 150, fontFamily, fontWeight: 700, fontSize: 40, lineHeight: 1.1, color: "#F5F7FA", textShadow: "0 2px 18px rgba(0,0,0,.7)" }}>{podcast.title}</div>
      ) : null}
      <div
        style={{
          position: "absolute",
          top: 1362,
          left: 0,
          width: 930,
          height: 150,
          display: "flex",
          alignItems: "center",
          gap: 22,
          paddingLeft: 64,
          paddingRight: 44,
          boxSizing: "border-box",
          backgroundColor: "rgba(7,11,18,.86)",
          borderTopRightRadius: 75,
          borderBottomRightRadius: 75,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", flexShrink: 0 }}>
          {podcast.speakers.map((host, index) => {
            const active = index === speaker;
            return (
              <div
                key={host.name}
                style={{
                  width: 84,
                  height: 84,
                  marginLeft: index === 0 ? 0 : -14,
                  zIndex: active ? 2 : 1,
                  borderRadius: 42,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxSizing: "border-box",
                  fontFamily,
                  fontWeight: 800,
                  fontSize: 42,
                  color: active ? "#0B111B" : "#F5F7FA",
                  backgroundColor: active ? host.color : "#283647",
                  border: "5px solid #070B12",
                  transform: `scale(${active ? 1.08 + levelAt(0) * 0.1 : 0.92})`,
                }}
              >
                {host.name[0]?.toUpperCase()}
              </div>
            );
          })}
        </div>
        <div style={{ flex: 1, height: 110, display: "flex", alignItems: "center", gap: 7 }}>
          {Array.from({ length: WAVE_BARS }, (_, index) => {
            const level = levelAt(index);
            return (
              <div
                key={index}
                style={{
                  flex: 1,
                  height: 8 + level * 100,
                  borderRadius: 6,
                  backgroundColor: color,
                  opacity: 1 - (index / WAVE_BARS) * 0.72,
                }}
              />
            );
          })}
        </div>
        <div style={{ position: "absolute", left: 0, bottom: 0, height: 7, width: `${progress * 100}%`, backgroundColor: color }} />
      </div>
    </>
  );
}

/** Background used when a scene has no footage: drifting brand-colored fields, never stock. */
function TypographicCard({ color, secondary, seed, text }: { color: string; secondary: string; seed: number; text?: string }) {
  const frame = useCurrentFrame();
  const drift = interpolate(frame, [0, 300], [0, 18]);
  const angle = (seed * 37) % 360;
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0B111B",
        backgroundImage: `radial-gradient(900px 900px at ${30 + drift}% ${28 + (seed % 30)}%, ${color}38, transparent 70%),
          radial-gradient(800px 800px at ${78 - drift}% ${74 - (seed % 20)}%, ${secondary}30, transparent 70%),
          linear-gradient(${angle}deg, #101927, #0B111B)`,
        alignItems: "center",
        justifyContent: "center",
        padding: 90,
      }}
    >
      {text ? <div style={{ fontFamily: FONT, fontSize: 72, fontWeight: 700, color: "#F5F7FA", textAlign: "center" }}>{text}</div> : null}
    </AbsoluteFill>
  );
}

function KineticText({ overlay, color }: { overlay: TextOverlay; color: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = interpolate(frame, [0, fps * 0.25], [0, 1], { extrapolateRight: "clamp" });
  const exit = interpolate(frame, [overlay.durationInFrames - 8, overlay.durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        top: 300,
        left: 70,
        right: 70,
        fontFamily: FONT,
        fontWeight: 800,
        fontSize: 78,
        lineHeight: 1.08,
        letterSpacing: -1.5,
        color: "#F5F7FA",
        opacity: enter * exit,
        transform: `translateY(${(1 - enter) * 26}px)`,
        borderLeft: `10px solid ${color}`,
        paddingLeft: 32,
        textShadow: "0 4px 28px rgba(0,0,0,.55)",
      }}
    >
      {overlay.text}
    </div>
  );
}

function Caption({ cue, captionStyle }: { cue: CaptionCue; captionStyle: TimelineProps["spec"]["style"]["caption"] }) {
  const frame = useCurrentFrame();
  const words = cue.words.length > 0 ? cue.words : [{ text: cue.text, from: 0, to: cue.durationInFrames }];
  return (
    <div
      style={{
        position: "absolute",
        top: `${captionStyle.positionY * 100}%`,
        left: 70,
        right: 70,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          fontFamily: captionStyle.fontFamily,
          fontSize: captionStyle.fontSize,
          fontWeight: 800,
          lineHeight: 1.2,
          textAlign: "center",
          textTransform: captionStyle.uppercase ? "uppercase" : "none",
          color: captionStyle.textColor,
          padding: captionStyle.background ? "14px 28px" : 0,
          borderRadius: 18,
          backgroundColor: captionStyle.background ? "rgba(11,17,27,.72)" : "transparent",
          textShadow: captionStyle.background ? "none" : "0 3px 18px rgba(0,0,0,.85)",
        }}
      >
        {words.map((word, index) => (
          <span key={index} style={{ color: frame >= word.from && frame < word.to ? captionStyle.highlightColor : undefined }}>
            {word.text}
            {index < words.length - 1 ? " " : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
