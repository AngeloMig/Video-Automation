"use client";

import { Player, type PlayerRef } from "@remotion/player";
import { type ComponentType, forwardRef } from "react";
import { Timeline } from "@/remotion/Timeline";
import type { TimelineProps, TimelineSpec } from "@/timeline/spec";

export function assetUrlsFor(ids: string[]): Record<string, string> {
  return Object.fromEntries(ids.map((id) => [id, `/api/media/${id}`]));
}

/** Previews through the same component the worker renders, so what you see is what exports. */
export const TimelinePlayer = forwardRef<PlayerRef, { spec: TimelineSpec; assetUrls: Record<string, string>; className?: string; loop?: boolean; autoPlay?: boolean }>(
  function TimelinePlayer({ spec, assetUrls, className, loop, autoPlay }, ref) {
    const inputProps: TimelineProps = { spec, assetUrls };
    return (
      <Player
        ref={ref}
        component={Timeline as unknown as ComponentType<Record<string, unknown>>}
        inputProps={inputProps as unknown as Record<string, unknown>}
        durationInFrames={spec.durationInFrames}
        fps={spec.fps}
        compositionWidth={spec.width}
        compositionHeight={spec.height}
        controls
        loop={loop}
        autoPlay={autoPlay}
        className={className}
        style={{ width: "100%", aspectRatio: "9 / 16", borderRadius: 8, overflow: "hidden" }}
      />
    );
  },
);
