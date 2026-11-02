import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipAnalysisForm, ManualClipForm } from "@/components/clip-forms";
import { ClipCard } from "@/components/clip-card";
import { EmptyState, formatDuration, JobStatus, PageBody, PageHeader, Panel, SetupNotice } from "@/components/kit";
import { LiveRefresh } from "@/components/live";
import { mediaAssets, productionJobs, renderedVideos, sourceAssets, transcripts, videoProjects } from "@/db/schema";
import { isUuid } from "@/server/api";
import { query } from "@/server/context";
import { hasLlm } from "@/services/registry";

export const metadata = { title: "Source video" };

export default async function ClipSourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await query(async (tx, ctx) => {
    const [row] = await tx
      .select({ source: sourceAssets, media: mediaAssets })
      .from(sourceAssets)
      .innerJoin(mediaAssets, eq(mediaAssets.id, sourceAssets.mediaAssetId))
      .where(and(eq(sourceAssets.id, id), eq(sourceAssets.workspaceId, ctx.workspaceId)));
    if (!row) return null;
    const [transcript] = await tx.select().from(transcripts).where(eq(transcripts.sourceAssetId, id));
    const clips = await tx
      .select({
        video: videoProjects,
        renderAssetId: sql<string | null>`(select r.media_asset_id from ${renderedVideos} r where r.video_project_id = ${videoProjects.id} order by r.created_at desc limit 1)`,
      })
      .from(videoProjects)
      .where(eq(videoProjects.sourceAssetId, id))
      .orderBy(desc(videoProjects.opportunityScore), desc(videoProjects.createdAt));
    const jobs = await tx
      .select()
      .from(productionJobs)
      .where(and(eq(productionJobs.workspaceId, ctx.workspaceId), inArray(productionJobs.kind, ["clip.transcribe", "clip.detect"]), sql`${productionJobs.payload} ->> 'sourceAssetId' = ${id}`))
      .orderBy(desc(productionJobs.createdAt))
      .limit(4);
    return { ...row, transcript, clips, jobs };
  });
  if (!data) notFound();
  const { source, media, transcript, clips, jobs } = data;
  const active = jobs.some((job) => job.status === "queued" || job.status === "running") || clips.some((c) => c.video.status === "in_production" || c.video.status === "rendering");

  return (
    <>
      <LiveRefresh active={active} />
      <PageHeader
        title={source.title}
        description={
          <>
            <Link href={`/clipper?project=${source.projectId}`} className="inline-flex items-center gap-1 hover:text-foreground">
              <ArrowLeft className="size-3.5" aria-hidden /> AI Clipper
            </Link>{" "}
            · <span className="readout">{formatDuration(media.durationSeconds)}</span> · Rights confirmed: {source.rightsBasis.replaceAll("_", " ")}
          </>
        }
      />
      <PageBody>
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="space-y-6 lg:col-span-2">
            <Panel>
              <video src={`/api/media/${media.id}`} controls preload="metadata" className="aspect-video w-full rounded-lg bg-black" />
            </Panel>
            {hasLlm() ? (
              <ClipAnalysisForm sourceAssetId={source.id} transcribed={Boolean(transcript)} busy={active} />
            ) : (
              <SetupNotice title="Automatic highlights need OpenAI" envVars={["OPENAI_API_KEY"]}>
                Add a key to transcribe this video and find its best moments.
              </SetupNotice>
            )}
            <ManualClipForm sourceAssetId={source.id} durationSeconds={media.durationSeconds ?? 0} hasTranscript={Boolean(transcript)} />
            {jobs.length > 0 ? (
              <Panel title="Analysis jobs">
                <ul className="divide-y divide-border">
                  {jobs.map((job) => (
                    <li key={job.id} className="px-4 py-2.5">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate">{job.label}</span>
                        <JobStatus status={job.status} />
                      </div>
                      {job.errorMessage ? <p className="mt-1 text-xs text-destructive">{job.errorMessage}</p> : null}
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}
          </div>
          <div className="space-y-6 lg:col-span-3">
            <Panel title={`Clips (${clips.length})`} description="Scores are estimated content opportunity, not a prediction of views.">
              {clips.length === 0 ? (
                <EmptyState title="No clips yet">Find highlights automatically, or cut one by timecode.</EmptyState>
              ) : (
                <div className="grid gap-3 p-3 sm:grid-cols-2">
                  {clips.map(({ video, renderAssetId }) => (
                    <ClipCard
                      key={video.id}
                      id={video.id}
                      title={video.title}
                      hook={video.hook}
                      status={video.status}
                      score={video.opportunityScore}
                      reason={video.scoreReason}
                      start={video.sourceStartSeconds}
                      end={video.sourceEndSeconds}
                      durationSeconds={video.timeline ? video.timeline.durationInFrames / video.timeline.fps : null}
                      renderAssetId={renderAssetId}
                      lastError={video.lastError}
                    />
                  ))}
                </div>
              )}
            </Panel>
            <Panel title="Transcript" description={transcript ? `Word-level timestamps from ${transcript.provider}` : undefined}>
              {transcript ? (
                <ol className="max-h-96 divide-y divide-border overflow-y-auto">
                  {transcript.segments.map((segment, index) => (
                    <li key={index} className="flex gap-3 px-4 py-2 text-sm">
                      <span className="readout shrink-0 text-xs text-muted-foreground">{formatDuration(segment.start)}</span>
                      <span className="text-muted-foreground">{segment.text}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyState title="Not transcribed yet" />
              )}
            </Panel>
          </div>
        </div>
      </PageBody>
    </>
  );
}
