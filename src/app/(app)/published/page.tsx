import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Download } from "lucide-react";
import Link from "next/link";
import { EmptyState, formatDuration, formatRelative, PageBody, PageHeader, Panel, SetupNotice, VideoStatus } from "@/components/kit";
import { buttonVariants } from "@/components/ui/button";
import { publishingJobs, renderedVideos, videoProjects } from "@/db/schema";
import { query } from "@/server/context";

export const metadata = { title: "Published Videos" };

export default async function PublishedPage() {
  const { videos, published } = await query(async (tx, ctx) => ({
    videos: await tx
      .select({
        video: videoProjects,
        render: renderedVideos,
      })
      .from(videoProjects)
      .innerJoin(renderedVideos, sql`${renderedVideos.id} = (select r.id from ${renderedVideos} r where r.video_project_id = ${videoProjects.id} order by r.created_at desc limit 1)`)
      .where(and(eq(videoProjects.workspaceId, ctx.workspaceId), inArray(videoProjects.status, ["pending_approval", "approved"])))
      .orderBy(desc(videoProjects.updatedAt))
      .limit(60),
    published: await tx.select().from(publishingJobs).where(and(eq(publishingJobs.workspaceId, ctx.workspaceId), eq(publishingJobs.status, "published"))).limit(60),
  }));
  return (
    <>
      <PageHeader title="Published Videos" description="Videos ready to approve and export, and anything confirmed live on a platform." />
      <PageBody>
        <SetupNotice title="Direct publishing arrives in Phase 2">For now, export the MP4 and upload it yourself. A video only shows as published here after the platform confirms it.</SetupNotice>
        <Panel title={`Ready to export (${videos.length})`}>
          {videos.length === 0 ? (
            <EmptyState title="No finished videos yet" action={<Link href="/faceless" className={buttonVariants()}>Create a video</Link>}>Rendered videos appear here once they pass their quality checks.</EmptyState>
          ) : (
            <ul className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {videos.map(({ video, render }) => (
                <li key={video.id} className="flex flex-col">
                  <Link href={`/videos/${video.id}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/media/${render.mediaAssetId}?variant=thumbnail`} alt={`Preview of ${video.title}`} loading="lazy" className="aspect-[9/16] w-full rounded-md bg-muted object-cover transition-opacity hover:opacity-85" />
                  </Link>
                  <p className="mt-2 line-clamp-2 text-sm">{video.title}</p>
                  <p className="readout mt-0.5 text-xs text-muted-foreground">{formatDuration(render.durationSeconds)} · {formatRelative(render.createdAt)}</p>
                  <div className="mt-1.5 flex items-center justify-between gap-1">
                    <VideoStatus status={video.status} />
                    <a href={`/api/media/${render.mediaAssetId}?download=1`} aria-label={`Export ${video.title}`} className={buttonVariants({ size: "icon-sm", variant: "ghost" })}><Download className="size-3.5" aria-hidden /></a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Live on platforms">
          {published.length === 0 ? <EmptyState title="Nothing published yet" /> : (
            <ul className="divide-y divide-border">
              {published.map((job) => (
                <li key={job.id} className="px-4 py-2.5 text-sm">{job.externalUrl ? <a href={job.externalUrl} className="text-primary hover:underline">{job.externalUrl}</a> : job.externalPostId}</li>
              ))}
            </ul>
          )}
        </Panel>
      </PageBody>
    </>
  );
}
