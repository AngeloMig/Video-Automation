"use client";

import { ArrowDown, ArrowUp, Scissors, Trash2 } from "lucide-react";
import { useEditor } from "@/components/editor/store";
import { fieldClass } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { deleteVisual, moveScene, sceneBlocks, splitVisualAt, trimVisual, updateCaptionStyle, updateVisual } from "@/timeline/edit";

const FONTS = [
  ["Inter, Helvetica, Arial, sans-serif", "Inter"],
  ["Georgia, 'Times New Roman', serif", "Georgia"],
  ["'Arial Black', Helvetica, Arial, sans-serif", "Arial Black"],
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-b border-border p-3">
      <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

export function Inspector({ frameToSeek }: { frameToSeek: (frame: number) => void }) {
  const { spec, selection, frame, apply, select } = useEditor();
  if (!spec) return null;
  const clip = selection?.track === "visual" ? spec.tracks.visual.find((c) => c.id === selection.id) : undefined;
  const captionStyle = spec.style.caption;
  const seconds = (frames: number) => (frames / spec.fps).toFixed(2);
  const blockKey = clip?.sceneId ?? clip?.id;
  const blocks = sceneBlocks(spec);
  const blockIndex = blocks.findIndex((block) => block.key === blockKey);

  return (
    <aside className="min-h-0 overflow-y-auto">
      <Section title={clip ? "Selected clip" : "Clip"}>
        {!clip ? (
          <p className="text-sm text-muted-foreground">Select a clip on the timeline to trim it, reframe it or change its transition.</p>
        ) : (
          <>
            <dl className="readout grid grid-cols-2 gap-1 text-xs">
              <dt className="text-muted-foreground">Type</dt>
              <dd className="capitalize">{clip.type === "card" ? "Typographic card" : clip.type}</dd>
              <dt className="text-muted-foreground">Starts at</dt>
              <dd>{seconds(clip.from)}s</dd>
              <dt className="text-muted-foreground">Length</dt>
              <dd>{seconds(clip.durationInFrames)}s</dd>
            </dl>
            <div className="flex flex-wrap gap-1">
              <Button size="xs" variant="outline" onClick={() => apply((current) => trimVisual(current, clip.id, "start", 15))}>
                Trim start 0.5s
              </Button>
              <Button size="xs" variant="outline" onClick={() => apply((current) => trimVisual(current, clip.id, "end", 15))}>
                Trim end 0.5s
              </Button>
              <Button size="xs" variant="outline" disabled={frame <= clip.from || frame >= clip.from + clip.durationInFrames} onClick={() => apply((current) => splitVisualAt(current, frame))}>
                <Scissors className="size-3" aria-hidden /> Split at playhead
              </Button>
              <Button size="xs" variant="outline" disabled={blockIndex <= 0} onClick={() => apply((current) => moveScene(current, blockKey!, -1))}>
                <ArrowUp className="size-3" aria-hidden /> Earlier
              </Button>
              <Button size="xs" variant="outline" disabled={blockIndex < 0 || blockIndex >= blocks.length - 1} onClick={() => apply((current) => moveScene(current, blockKey!, 1))}>
                <ArrowDown className="size-3" aria-hidden /> Later
              </Button>
              <Button
                size="xs"
                variant="destructive"
                disabled={spec.tracks.visual.length <= 1}
                onClick={() => {
                  apply((current) => deleteVisual(current, clip.id));
                  select(null);
                  frameToSeek(0);
                }}
              >
                <Trash2 className="size-3" aria-hidden /> Delete
              </Button>
            </div>
            {clip.type !== "card" ? (
              <div className="space-y-1">
                <Label htmlFor="focus" className="text-xs">
                  Crop position
                </Label>
                <input id="focus" type="range" min={0} max={1} step={0.01} value={clip.focusX} onChange={(event) => apply((current) => updateVisual(current, clip.id, { focusX: Number(event.target.value) }))} className="w-full accent-[#58D5C9]" />
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="transition" className="text-xs">
                  Transition in
                </Label>
                <select
                  id="transition"
                  className={`${fieldClass} h-8 text-xs`}
                  value={clip.transition}
                  onChange={(event) => {
                    const transition = event.target.value as "cut" | "fade";
                    apply((current) => updateVisual(current, clip.id, { transition, transitionFrames: transition === "fade" ? clip.transitionFrames || 12 : 0 }));
                  }}
                >
                  <option value="cut">Cut</option>
                  <option value="fade">Fade</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="transition-frames" className="text-xs">
                  Length (frames)
                </Label>
                <input
                  id="transition-frames"
                  type="number"
                  min={0}
                  max={60}
                  disabled={clip.transition === "cut"}
                  value={clip.transitionFrames}
                  onChange={(event) => apply((current) => updateVisual(current, clip.id, { transitionFrames: Math.max(Number(event.target.value), 0) }))}
                  className={`${fieldClass} readout h-8 text-xs`}
                />
              </div>
            </div>
          </>
        )}
      </Section>

      <Section title="Caption style">
        <div className="space-y-1">
          <Label htmlFor="font" className="text-xs">
            Font
          </Label>
          <select id="font" className={`${fieldClass} h-8 text-xs`} value={captionStyle.fontFamily} onChange={(event) => apply((current) => updateCaptionStyle(current, { fontFamily: event.target.value }))}>
            {FONTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="size" className="text-xs">
            Size
          </Label>
          <input id="size" type="range" min={24} max={140} value={captionStyle.fontSize} onChange={(event) => apply((current) => updateCaptionStyle(current, { fontSize: Number(event.target.value) }))} className="w-full accent-[#58D5C9]" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="position" className="text-xs">
            Vertical position
          </Label>
          <input id="position" type="range" min={0.1} max={0.9} step={0.01} value={captionStyle.positionY} onChange={(event) => apply((current) => updateCaptionStyle(current, { positionY: Number(event.target.value) }))} className="w-full accent-[#58D5C9]" />
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-xs">
            <input type="color" value={captionStyle.textColor} onChange={(event) => apply((current) => updateCaptionStyle(current, { textColor: event.target.value }))} className="size-6 cursor-pointer rounded border border-input bg-transparent" />
            Text
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <input type="color" value={captionStyle.highlightColor} onChange={(event) => apply((current) => updateCaptionStyle(current, { highlightColor: event.target.value }))} className="size-6 cursor-pointer rounded border border-input bg-transparent" />
            Highlight
          </label>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={captionStyle.uppercase} onChange={(event) => apply((current) => updateCaptionStyle(current, { uppercase: event.target.checked }))} className="accent-[#58D5C9]" />
          Uppercase
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={captionStyle.background} onChange={(event) => apply((current) => updateCaptionStyle(current, { background: event.target.checked }))} className="accent-[#58D5C9]" />
          Background behind captions
        </label>
      </Section>
    </aside>
  );
}
