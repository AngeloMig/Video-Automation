"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import type { ScoreBreakdown } from "@/db/schema";
import { formatCompact, formatDuration, formatRelative, StatusPill } from "@/components/kit";
import { ActionButton } from "@/components/live";
import { buttonVariants } from "@/components/ui/button";
import { setDiscoveredStatusAction } from "@/server/actions";

type Video = {
  id: string;
  projectId: string;
  youtubeId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  publishedAt: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  opportunityScore: number | null;
  scoreBreakdown: ScoreBreakdown | null;
  topicTags: string[];
  suggestedMode: "clipper" | "faceless" | null;
  status: string;
};

export function DiscoveryCard({ video }: { video: Video }) {
  const breakdown = video.scoreBreakdown;
  return (
    <article className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="relative aspect-video bg-muted">
        {video.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={video.thumbnailUrl} alt="" loading="lazy" className="size-full object-cover" />
        ) : null}
        <span className="readout absolute right-1.5 bottom-1.5 rounded bg-black/75 px-1.5 py-0.5 text-xs">{formatDuration(video.durationSeconds)}</span>
      </div>
      <div className="flex flex-1 flex-col p-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 text-sm font-medium">{video.title}</h3>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {video.channelTitle} · {formatRelative(video.publishedAt)}
            </p>
          </div>
          {video.opportunityScore !== null ? (
            <div className="shrink-0 text-right" title="Estimated content opportunity score. It estimates fit for this project and doesn't predict views.">
              <div className="readout text-xl leading-none text-primary">{video.opportunityScore}</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">{breakdown?.complete ? "opportunity" : "partial"}</div>
            </div>
          ) : null}
        </div>
        <p className="readout mt-2 text-xs text-muted-foreground">
          {formatCompact(video.viewCount)} views · {formatCompact(video.likeCount)} likes · {formatCompact(video.commentCount)} comments
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          <StatusPill tone="warn">Metadata only: rights not cleared</StatusPill>
          {video.suggestedMode ? <StatusPill tone="info">Suggested: {video.suggestedMode === "clipper" ? "AI Clipper" : "Faceless"}</StatusPill> : null}
          {video.topicTags.map((tag) => (
            <StatusPill key={tag}>{tag}</StatusPill>
          ))}
        </div>
        {breakdown ? (
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Why this score</summary>
            <ul className="mt-1.5 space-y-1.5">
              {breakdown.factors.map((factor) => (
                <li key={factor.key}>
                  <div className="flex justify-between gap-2">
                    <span>{factor.label}</span>
                    <span className="readout text-muted-foreground">{factor.score ?? "n/a"}</span>
                  </div>
                  <div className="mt-0.5 h-1 overflow-hidden rounded bg-muted">
                    <div className="h-full bg-primary/70" style={{ width: `${factor.score ?? 0}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center gap-1 pt-3">
          <Link href={`/faceless?project=${video.projectId}&from=${video.id}`} className={buttonVariants({ size: "sm" })}>
            Create original video
          </Link>
          <ActionButton size="sm" variant="ghost" action={setDiscoveredStatusAction.bind(null, video.id, video.status === "saved" ? "new" : "saved")}>
            {video.status === "saved" ? "Unsave" : "Save"}
          </ActionButton>
          <ActionButton size="sm" variant="ghost" action={setDiscoveredStatusAction.bind(null, video.id, "dismissed")}>
            Dismiss
          </ActionButton>
          <a href={`https://www.youtube.com/watch?v=${video.youtubeId}`} target="_blank" rel="noreferrer" aria-label={`Open ${video.title} on YouTube`} className={buttonVariants({ size: "icon-sm", variant: "ghost" })}>
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </div>
      </div>
    </article>
  );
}
