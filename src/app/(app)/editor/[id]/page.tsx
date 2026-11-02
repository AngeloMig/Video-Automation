import { and, desc, eq, inArray, or } from "drizzle-orm";
import { notFound } from "next/navigation";
import { EmptyState, PageBody, PageHeader, Panel } from "@/components/kit";
import { VideoEditor } from "@/components/editor/video-editor";
import { mediaAssets, videoProjects, videoProjectVersions } from "@/db/schema";
import { isUuid } from "@/server/api";
import { query } from "@/server/context";

export const metadata = { title: "Video Editor" };

export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await query(async (tx, ctx) => {
    const [video] = await tx.select().from(videoProjects).where(and(eq(videoProjects.id, id), eq(videoProjects.workspaceId, ctx.workspaceId)));
    if (!video) return null;
    const library = await tx
      .select()
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.workspaceId, ctx.workspaceId),
          eq(mediaAssets.status, "ready"),
          inArray(mediaAssets.kind, ["broll_video", "broll_image"]),
          or(eq(mediaAssets.projectId, video.projectId)),
        ),
      )
      .orderBy(desc(mediaAssets.createdAt))
      .limit(60);
    const versions = await tx
      .select({ version: videoProjectVersions.version, note: videoProjectVersions.note, createdAt: videoProjectVersions.createdAt })
      .from(videoProjectVersions)
      .where(eq(videoProjectVersions.videoProjectId, id))
      .orderBy(desc(videoProjectVersions.version))
      .limit(20);
    return { video, library, versions };
  });
  if (!data) notFound();
  const { video, library, versions } = data;

  if (!video.timeline) {
    return (
      <>
        <PageHeader title={video.title} />
        <PageBody>
          <Panel>
            <EmptyState title="The timeline isn't ready yet">It appears once the Editing Agent assembles this video.</EmptyState>
          </Panel>
        </PageBody>
      </>
    );
  }
  return (
    <VideoEditor
      key={`${video.id}-${video.timelineVersion}`}
      videoId={video.id}
      projectId={video.projectId}
      title={video.title}
      status={video.status}
      initialSpec={video.timeline}
      version={video.timelineVersion}
      versions={versions.map((v) => ({ version: v.version, note: v.note, createdAt: v.createdAt.toISOString() }))}
      library={library.map((asset) => ({
        id: asset.id,
        kind: asset.kind === "broll_image" ? ("image" as const) : ("video" as const),
        name: asset.filename ?? String(asset.metadata.query ?? "Stock clip"),
        durationSeconds: asset.durationSeconds,
      }))}
    />
  );
}
