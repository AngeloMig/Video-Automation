"use client";

import type { PlayerRef } from "@remotion/player";
import { ArrowLeft, Redo2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Inspector } from "@/components/editor/inspector";
import { LeftPanel, type LibraryAsset } from "@/components/editor/left-panel";
import { useEditor } from "@/components/editor/store";
import { TimelineTracks } from "@/components/editor/timeline-tracks";
import { fieldClass, VideoStatus } from "@/components/kit";
import { assetUrlsFor, TimelinePlayer } from "@/components/timeline-player";
import { Button } from "@/components/ui/button";
import { requestRenderAction, restoreVersionAction, saveTimelineAction } from "@/server/actions";
import { collectAssetIds, type TimelineSpec } from "@/timeline/spec";

export type VersionEntry = { version: number; note: string | null; createdAt: string };

export function VideoEditor({
  videoId,
  projectId,
  title,
  status,
  initialSpec,
  version,
  versions,
  library,
}: {
  videoId: string;
  projectId: string;
  title: string;
  status: string;
  initialSpec: TimelineSpec;
  version: number;
  versions: VersionEntry[];
  library: LibraryAsset[];
}) {
  const router = useRouter();
  const player = useRef<PlayerRef>(null);
  const { spec, dirty, past, future, undo, redo, init, setFrame, markSaved } = useEditor();
  const [pending, start] = useTransition();
  const [safeZones, setSafeZones] = useState(false);

  useEffect(() => init(initialSpec), [init, initialSpec]);

  useEffect(() => {
    const current = player.current;
    if (!current) return;
    const onFrame = (event: { detail: { frame: number } }) => setFrame(event.detail.frame);
    current.addEventListener("frameupdate", onFrame);
    return () => current.removeEventListener("frameupdate", onFrame);
  }, [setFrame, spec !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const assetUrls = useMemo(() => (spec ? assetUrlsFor(collectAssetIds(spec)) : {}), [spec]);
  if (!spec) return null;

  const seek = (frame: number) => {
    player.current?.seekTo(frame);
    setFrame(frame);
  };

  const save = (then?: () => Promise<void>) =>
    start(async () => {
      if (dirty) {
        const result = await saveTimelineAction(videoId, spec);
        if (!result.ok) return void toast.error(result.error);
        markSaved();
        if (!then) toast.success(`Saved version ${result.data}`);
      }
      await then?.();
      router.refresh();
    });

  return (
    <div className="flex min-h-dvh flex-col md:h-dvh md:min-h-0">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Link href={`/videos/${videoId}`} aria-label="Back to video" className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="min-w-0 truncate text-sm font-medium">{title}</h1>
        <VideoStatus status={status} />
        <span className="readout text-xs text-muted-foreground">
          v{version}
          {dirty ? " · unsaved changes" : ""}
        </span>
        <span className="flex-1" />
        <Button size="icon-sm" variant="ghost" aria-label="Undo" disabled={past.length === 0} onClick={undo}>
          <Undo2 className="size-4" />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Redo" disabled={future.length === 0} onClick={redo}>
          <Redo2 className="size-4" />
        </Button>
        {versions.length > 0 ? (
          <select
            aria-label="Restore a saved version"
            className={`${fieldClass} h-7 w-36 text-xs`}
            value=""
            disabled={pending}
            onChange={(event) => {
              const target = Number(event.target.value);
              if (!target || (dirty && !window.confirm("Discard your unsaved changes and restore this version?"))) return;
              start(async () => {
                const result = await restoreVersionAction(videoId, target);
                if (!result.ok) return void toast.error(result.error);
                toast.success(`Restored version ${target}`);
                router.refresh();
              });
            }}
          >
            <option value="">Restore version…</option>
            {versions.map((entry) => (
              <option key={entry.version} value={entry.version}>
                v{entry.version} · {new Date(entry.createdAt).toLocaleDateString()}
              </option>
            ))}
          </select>
        ) : null}
        <Button size="sm" variant="outline" disabled={!dirty || pending} onClick={() => save()}>
          Save version
        </Button>
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            save(async () => {
              const result = await requestRenderAction(videoId);
              if (!result.ok) return void toast.error(result.error);
              toast.success("Render queued");
              router.push(`/videos/${videoId}`);
            })
          }
        >
          {dirty ? "Save and render" : "Render"}
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)_280px]">
        <LeftPanel projectId={projectId} library={library} seek={seek} />
        <div className="flex min-h-0 flex-col items-center gap-2 overflow-hidden border-y border-border bg-background p-3 md:border-x md:border-y-0">
          <div className="relative aspect-[9/16] h-[60dvh] max-w-full md:h-auto md:min-h-0 md:flex-1">
            <TimelinePlayer ref={player} spec={spec} assetUrls={assetUrls} />
            {safeZones ? (
              // Approximate regions that platform buttons and captions cover on Reels and Shorts.
              <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
                <div className="absolute inset-x-0 top-0 h-[12%] bg-destructive/20" />
                <div className="absolute inset-x-0 bottom-0 h-[20%] bg-destructive/20" />
                <div className="absolute top-[12%] right-0 bottom-[20%] w-[14%] bg-destructive/20" />
              </div>
            ) : null}
          </div>
          <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={safeZones} onChange={(event) => setSafeZones(event.target.checked)} className="accent-[#58D5C9]" />
            Show safe zones
          </label>
        </div>
        <Inspector frameToSeek={seek} />
      </div>

      <TimelineTracks seek={seek} />
    </div>
  );
}
