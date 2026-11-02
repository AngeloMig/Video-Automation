"use client";

import Link from "next/link";
import { formatDuration, VideoStatus } from "@/components/kit";
import { ActionButton } from "@/components/live";
import { buttonVariants } from "@/components/ui/button";
import { deleteVideoAction, requestRenderAction } from "@/server/actions";

export function ClipCard(props: {
  id: string;
  title: string;
  hook: string | null;
  status: string;
  score: number | null;
  reason: string | null;
  start: number | null;
  end: number | null;
  durationSeconds: number | null;
  renderAssetId: string | null;
  lastError: string | null;
}) {
  const busy = props.status === "in_production" || props.status === "rendering";
  return (
    <article className="flex flex-col rounded-md border border-border bg-background/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/videos/${props.id}`} className="min-w-0 text-sm font-medium hover:text-primary">
          {props.title}
        </Link>
        {props.score !== null ? (
          <span className="readout shrink-0 text-lg leading-none text-primary" title="Estimated content opportunity score">
            {props.score}
          </span>
        ) : null}
      </div>
      {props.hook ? <p className="mt-1 text-xs text-foreground/80">&ldquo;{props.hook}&rdquo;</p> : null}
      {props.reason ? <p className="mt-1 text-xs text-muted-foreground">{props.reason}</p> : null}
      <p className="readout mt-2 text-xs text-muted-foreground">
        {formatDuration(props.start)}–{formatDuration(props.end)} · {formatDuration(props.durationSeconds)} after trimming
      </p>
      {props.renderAssetId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/media/${props.renderAssetId}?variant=thumbnail`} alt={`Preview of ${props.title}`} className="mt-2 aspect-[9/16] w-24 rounded object-cover" />
      ) : null}
      {props.lastError ? <p className="mt-2 text-xs text-destructive">{props.lastError}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 pt-1">
        <VideoStatus status={props.status} />
        <span className="flex-1" />
        <Link href={`/editor/${props.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          Edit
        </Link>
        <ActionButton variant="ghost" size="sm" action={deleteVideoAction.bind(null, props.id)} confirm={`Delete “${props.title}”?`}>
          Delete
        </ActionButton>
        {props.status === "candidate" || props.status === "ready_to_render" || props.status === "failed" ? (
          <ActionButton size="sm" disabled={busy} action={requestRenderAction.bind(null, props.id)}>
            Render
          </ActionButton>
        ) : (
          <Link href={`/videos/${props.id}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
            Review
          </Link>
        )}
      </div>
    </article>
  );
}
