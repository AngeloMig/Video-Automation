"use client";

import { useState } from "react";
import { TimelinePlayer } from "@/components/timeline-player";
import { cn } from "@/lib/utils";
import type { TimelineSpec } from "@/timeline/spec";

/** The finished MP4 when one matches the timeline, with the live timeline one click away. */
export function VideoPreview({ renderAssetId, spec, assetUrls }: { renderAssetId: string | null; spec: TimelineSpec | null; assetUrls: Record<string, string> }) {
  const [view, setView] = useState<"render" | "live">("render");
  const showing = renderAssetId && view === "render" ? "render" : "live";

  if (!spec && !renderAssetId) {
    return (
      <div className="grid aspect-[9/16] w-full place-items-center rounded-lg border border-border bg-card px-6 text-center text-sm text-muted-foreground">
        The preview appears once the timeline is assembled.
      </div>
    );
  }
  return (
    <div>
      {showing === "render" ? (
        <video key={renderAssetId} src={`/api/media/${renderAssetId}`} controls preload="metadata" className="aspect-[9/16] w-full rounded-lg bg-black" />
      ) : (
        <TimelinePlayer spec={spec!} assetUrls={assetUrls} />
      )}
      {renderAssetId && spec ? (
        <div className="mt-2 flex gap-1 rounded-md bg-muted p-1 text-xs">
          {(
            [
              ["render", "Rendered MP4"],
              ["live", "Live timeline"],
            ] as const
          ).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={showing === value} onClick={() => setView(value)} className={cn("h-6 flex-1 rounded", showing === value ? "bg-card" : "text-muted-foreground hover:text-foreground")}>
              {label}
            </button>
          ))}
        </div>
      ) : !renderAssetId && spec ? (
        <p className="mt-2 text-xs text-muted-foreground">Live preview of the timeline. Render it to create the MP4.</p>
      ) : null}
    </div>
  );
}
