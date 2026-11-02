"use client";

import { Film, Image as ImageIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useEditor } from "@/components/editor/store";
import { formatDuration } from "@/components/kit";
import { AssetUploadButton } from "@/components/uploader";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { replaceVisualAsset, setSourceVolume, setTrackVolume, updateCaptionText } from "@/timeline/edit";

export type LibraryAsset = { id: string; kind: "video" | "image"; name: string; durationSeconds: number | null };

const TABS = ["Media", "Captions", "Text", "Audio"] as const;

function Volume({ label, value, onChange, disabled }: { label: string; value: number; onChange: (value: number) => void; disabled?: boolean }) {
  return (
    <label className="block text-sm">
      <span className="flex justify-between">
        <span>{label}</span>
        <span className="readout text-xs text-muted-foreground">{Math.round(value * 100)}%</span>
      </span>
      <input type="range" min={0} max={2} step={0.01} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} className="mt-1 w-full accent-[#58D5C9] disabled:opacity-40" />
    </label>
  );
}

export function LeftPanel({ projectId, library, seek }: { projectId: string; library: LibraryAsset[]; seek: (frame: number) => void }) {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Media");
  const { spec, selection, apply, select } = useEditor();
  if (!spec) return null;
  const selectedVisual = selection?.track === "visual" ? selection.id : null;
  const sourceClips = spec.tracks.visual.filter((clip) => clip.type === "video" && clip.volume > 0);

  return (
    <aside className="flex min-h-0 flex-col">
      <div role="tablist" aria-label="Editor tools" className="flex border-b border-border">
        {TABS.map((name) => (
          <button key={name} type="button" role="tab" aria-selected={tab === name} onClick={() => setTab(name)} className={cn("h-9 flex-1 border-b-2 text-xs transition-colors", tab === name ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {name}
          </button>
        ))}
      </div>
      <div className="max-h-72 min-h-0 flex-1 overflow-y-auto p-3 md:max-h-none">
        {tab === "Media" ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{selectedVisual ? "Choose footage to replace the selected clip." : "Select a clip on the timeline, then choose footage to replace it."}</p>
            <AssetUploadButton projectId={projectId} kind="broll_video" accept="video/mp4,video/quicktime,video/webm" label="Upload B-roll" onUploaded={() => router.refresh()} />
            {library.length === 0 ? <p className="text-sm text-muted-foreground">No footage in this project yet.</p> : null}
            <ul className="space-y-1">
              {library.map((asset) => (
                <li key={asset.id}>
                  <button
                    type="button"
                    disabled={!selectedVisual}
                    onClick={() => selectedVisual && apply((current) => replaceVisualAsset(current, selectedVisual, asset))}
                    className="flex w-full items-center gap-2 rounded-md border border-border px-2 py-1.5 text-left text-xs hover:border-primary/40 disabled:opacity-50"
                  >
                    {asset.kind === "video" ? <Film className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                    <span className="min-w-0 flex-1 truncate">{asset.name}</span>
                    <span className="readout text-muted-foreground">{formatDuration(asset.durationSeconds)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {tab === "Captions" ? (
          spec.tracks.captions.length === 0 ? (
            <p className="text-sm text-muted-foreground">This video has no captions. Clips get captions from a transcript, and faceless videos from their narration.</p>
          ) : (
            <ul className="space-y-1.5">
              {spec.tracks.captions.map((cue) => (
                <li key={cue.id}>
                  <Textarea
                    aria-label={`Caption at ${formatDuration(cue.from / spec.fps)}`}
                    rows={2}
                    defaultValue={cue.text}
                    key={`${cue.id}-${cue.text}`}
                    onFocus={() => {
                      select({ track: "captions", id: cue.id });
                      seek(cue.from);
                    }}
                    onBlur={(event) => {
                      if (event.target.value !== cue.text) apply((current) => updateCaptionText(current, cue.id, event.target.value));
                    }}
                    className={cn("min-h-0 text-xs", selection?.id === cue.id && "border-primary")}
                  />
                </li>
              ))}
            </ul>
          )
        ) : null}

        {tab === "Text" ? (
          spec.tracks.text.length === 0 ? (
            <p className="text-sm text-muted-foreground">This video has no on-screen text. The Signal and Bold templates add the hook here.</p>
          ) : (
            <ul className="space-y-2">
              {spec.tracks.text.map((overlay) => (
                <li key={overlay.id}>
                  <label className="text-xs text-muted-foreground" htmlFor={overlay.id}>
                    On-screen hook
                  </label>
                  <Textarea
                    id={overlay.id}
                    rows={2}
                    defaultValue={overlay.text}
                    key={`${overlay.id}-${overlay.text}`}
                    onFocus={() => seek(overlay.from)}
                    onBlur={(event) => {
                      if (event.target.value !== overlay.text) {
                        apply((current) => ({ ...current, tracks: { ...current.tracks, text: current.tracks.text.map((item) => (item.id === overlay.id ? { ...item, text: event.target.value } : item)) } }));
                      }
                    }}
                    className="mt-1 min-h-0 text-xs"
                  />
                </li>
              ))}
            </ul>
          )
        ) : null}

        {tab === "Audio" ? (
          <div className="space-y-4">
            {spec.tracks.narration.length > 0 ? <Volume label="Narration" value={spec.tracks.narration[0].volume} onChange={(value) => apply((current) => setTrackVolume(current, "narration", value))} /> : null}
            {sourceClips.length > 0 ? <Volume label="Source audio" value={sourceClips[0].volume} onChange={(value) => apply((current) => setSourceVolume(current, Math.max(value, 0.01)))} /> : null}
            {spec.tracks.music.length > 0 ? (
              <Volume label="Music" value={spec.tracks.music[0].volume} onChange={(value) => apply((current) => setTrackVolume(current, "music", value))} />
            ) : (
              <p className="text-xs text-muted-foreground">No music on this video. Add a licensed track in the project settings to use it on new videos.</p>
            )}
            <p className="text-xs text-muted-foreground">The final export is normalized to -14 LUFS.</p>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
