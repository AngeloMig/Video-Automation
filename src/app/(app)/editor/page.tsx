import { and, desc, eq, isNotNull } from "drizzle-orm";
import Link from "next/link";
import { EmptyState, formatDuration, formatRelative, PageBody, PageHeader, Panel, VideoStatus } from "@/components/kit";
import { buttonVariants } from "@/components/ui/button";
import { videoProjects } from "@/db/schema";
import { query } from "@/server/context";

export const metadata = { title: "Video Editor" };

export default async function EditorIndexPage() {
  const videos = await query((tx, ctx) =>
    tx.select().from(videoProjects).where(and(eq(videoProjects.workspaceId, ctx.workspaceId), isNotNull(videoProjects.timeline))).orderBy(desc(videoProjects.updatedAt)).limit(60),
  );
  return (
    <>
      <PageHeader title="Video Editor" description="Pick a video to trim, restyle or replace its footage. Exports use the same timeline you see here." />
      <PageBody>
        <Panel>
          {videos.length === 0 ? (
            <EmptyState title="Nothing to edit yet" action={<Link href="/faceless" className={buttonVariants()}>Create a video</Link>}>A video appears here once its timeline is assembled.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {videos.map((video) => (
                <li key={video.id}>
                  <Link href={`/editor/${video.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                    <span className="min-w-0 flex-1 truncate text-sm">{video.title}</span>
                    <span className="readout hidden text-xs text-muted-foreground sm:block">{video.timeline ? formatDuration(video.timeline.durationInFrames / video.timeline.fps) : ""} · v{video.timelineVersion} · {formatRelative(video.updatedAt)}</span>
                    <VideoStatus status={video.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </PageBody>
    </>
  );
}
