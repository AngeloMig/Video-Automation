"use client";

import { useRef } from "react";
import { useEditor } from "@/components/editor/store";
import { cn } from "@/lib/utils";

type Block = { id: string; from: number; durationInFrames: number; label?: string; selectable?: "visual" | "captions" };

function timecode(frame: number, fps: number) {
  const totalSeconds = frame / fps;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const frames = Math.floor(frame % fps);
  return `${minutes}:${String(seconds).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}

const TONE: Record<string, string> = {
  Visual: "border-primary/50 bg-primary/15",
  Narration: "border-[#77A9FF]/50 bg-[#77A9FF]/15",
  Text: "border-[#F2C572]/50 bg-[#F2C572]/15",
  Captions: "border-[#B8A6FF]/50 bg-[#B8A6FF]/15",
  Music: "border-[#F28FA8]/50 bg-[#F28FA8]/15",
};

export function TimelineTracks({ seek }: { seek: (frame: number) => void }) {
  const { spec, frame, selection, select } = useEditor();
  const lanes = useRef<HTMLDivElement>(null);
  if (!spec) return null;
  const total = spec.durationInFrames;
  const percent = (value: number) => `${(value / total) * 100}%`;

  const tracks: { name: string; blocks: Block[] }[] = [
    { name: "Visual", blocks: spec.tracks.visual.map((clip) => ({ id: clip.id, from: clip.from, durationInFrames: clip.durationInFrames, label: clip.type === "card" ? "Card" : clip.type === "image" ? "Image" : "Video", selectable: "visual" as const })) },
    { name: "Narration", blocks: spec.tracks.narration },
    { name: "Text", blocks: spec.tracks.text.map((overlay) => ({ id: overlay.id, from: overlay.from, durationInFrames: overlay.durationInFrames, label: overlay.text })) },
    { name: "Captions", blocks: spec.tracks.captions.map((cue) => ({ id: cue.id, from: cue.from, durationInFrames: cue.durationInFrames, selectable: "captions" as const })) },
    { name: "Music", blocks: spec.tracks.music },
  ];

  const scrub = (clientX: number) => {
    const bounds = lanes.current?.getBoundingClientRect();
    if (!bounds) return;
    seek(Math.round(Math.min(Math.max((clientX - bounds.left) / bounds.width, 0), 1) * (total - 1)));
  };

  return (
    <div className="shrink-0 border-t border-border bg-sidebar">
      <div className="readout flex items-center justify-between px-3 py-1 text-xs text-muted-foreground">
        <span>
          {timecode(frame, spec.fps)} / {timecode(total, spec.fps)}
        </span>
        <span>
          {spec.width}×{spec.height} · {spec.fps} fps
        </span>
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] grid-cols-[72px_1fr] pb-2">
          <div>
            {tracks.map((track) => (
              <div key={track.name} className="flex h-7 items-center px-3 text-[11px] text-muted-foreground">
                {track.name}
              </div>
            ))}
          </div>
          <div ref={lanes} className="relative mr-3">
            {tracks.map((track) => (
              <div
                key={track.name}
                className="relative h-7 border-b border-border/40"
                onPointerDown={(event) => {
                  if (event.target === event.currentTarget) {
                    select(null);
                    scrub(event.clientX);
                  }
                }}
              >
                {track.blocks.map((block) => {
                  const selected = selection?.id === block.id;
                  return (
                    <button
                      key={block.id}
                      type="button"
                      tabIndex={block.selectable ? 0 : -1}
                      aria-label={`${track.name} from ${timecode(block.from, spec.fps)}`}
                      onClick={(event) => {
                        if (block.selectable) select({ track: block.selectable, id: block.id });
                        scrub(event.clientX);
                      }}
                      style={{ left: percent(block.from), width: percent(block.durationInFrames) }}
                      className={cn("absolute inset-y-1 overflow-hidden rounded-sm border px-1 text-left text-[10px] leading-[18px] whitespace-nowrap", TONE[track.name], selected && "ring-2 ring-primary")}
                    >
                      {block.label}
                    </button>
                  );
                })}
              </div>
            ))}
            <div aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-foreground" style={{ left: percent(frame) }} />
          </div>
        </div>
      </div>
    </div>
  );
}
