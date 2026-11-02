import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Check, Download, Pencil, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, formatDuration, formatRelative, formatUsd, JobStatus, PageBody, PageHeader, Panel, StatusPill, VideoStatus } from "@/components/kit";
import { ActionButton, LiveRefresh } from "@/components/live";
import { SceneList } from "@/components/scene-list";
import { buttonVariants } from "@/components/ui/button";
import { VideoPreview } from "@/components/video-preview";
import { assetLicenses, contentIdeas, mediaAssets, productionJobs, renderedVideos, scripts, videoProjects, videoScenes } from "@/db/schema";
import { requestRenderAction, setApprovalAction } from "@/server/actions";
import { isUuid } from "@/server/api";
import { query } from "@/server/context";
import { collectAssetIds } from "@/timeline/spec";

export const metadata = { title: "Video" };

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await query(async (tx, ctx) => {
    const [video] = await tx.select().from(videoProjects).where(and(eq(videoProjects.id, id), eq(videoProjects.workspaceId, ctx.workspaceId)));
    if (!video) return null;
    const jobs = await tx.select().from(productionJobs).where(eq(productionJobs.videoProjectId, id)).orderBy(desc(productionJobs.createdAt)).limit(30);
    const [render] = await tx.select().from(renderedVideos).where(eq(renderedVideos.videoProjectId, id)).orderBy(desc(renderedVideos.createdAt)).limit(1);
    const [script] = await tx.select().from(scripts).where(eq(scripts.videoProjectId, id));
    const scenes = await tx.select().from(videoScenes).where(eq(videoScenes.videoProjectId, id)).orderBy(asc(videoScenes.position));
    const [idea] = video.contentIdeaId ? await tx.select().from(contentIdeas).where(eq(contentIdeas.id, video.contentIdeaId)) : [];
    const assetIds = video.timeline ? collectAssetIds(video.timeline) : [];
    const licenses = assetIds.length
      ? await tx
          .select({ provider: assetLicenses.provider, license: assetLicenses.license, sourceUrl: assetLicenses.sourceUrl, attribution: assetLicenses.attribution })
          .from(assetLicenses)
          .innerJoin(mediaAssets, eq(mediaAssets.id, assetLicenses.mediaAssetId))
          .where(inArray(assetLicenses.mediaAssetId, assetIds))
      : [];
    return { video, jobs, render, script, scenes, idea, licenses };
  });
  if (!data) notFound();
  const { video, jobs, render, script, scenes, idea, licenses } = data;

  const busy = jobs.some((job) => ["queued", "running", "cancel_requested"].includes(job.status));
  const renderIsCurrent = render && render.timelineVersion === video.timelineVersion;
  const totalCost = jobs.reduce((sum, job) => sum + job.costMicroUsd, 0);
  const estimatedCaptions = scenes.some((scene) => scene.timingSource === "estimated");
  const assetUrls = video.timeline ? Object.fromEntries(collectAssetIds(video.timeline).map((assetId) => [assetId, `/api/media/${assetId}`])) : {};

  return (
    <>
      <LiveRefresh active={busy} />
      <PageHeader
        title={video.title}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <VideoStatus status={video.status} />
            <span>{video.mode === "clipper" ? "AI Clipper" : "Faceless Creator"}</span>
            {video.timeline ? <span className="readout">{formatDuration(video.timeline.durationInFrames / video.timeline.fps)}</span> : null}
            {totalCost > 0 ? <span className="readout">{formatUsd(totalCost)} estimated cost</span> : null}
          </span>
        }
        actions={
          <>
            {video.timeline ? (
              <Link href={`/editor/${video.id}`} className={buttonVariants({ variant: "outline" })}>
                <Pencil className="size-3.5" aria-hidden /> Edit
              </Link>
            ) : null}
            {video.timeline && !renderIsCurrent && !busy ? (
              <ActionButton action={requestRenderAction.bind(null, video.id)} success="Render queued">
                Render
              </ActionButton>
            ) : null}
            {render && renderIsCurrent ? (
              <a href={`/api/media/${render.mediaAssetId}?download=1`} className={buttonVariants({ variant: "outline" })}>
                <Download className="size-3.5" aria-hidden /> Export MP4
              </a>
            ) : null}
            {video.status === "pending_approval" ? (
              <>
                <ActionButton variant="outline" action={setApprovalAction.bind(null, video.id, "rejected")} success="Video rejected">
                  <X className="size-3.5" aria-hidden /> Reject
                </ActionButton>
                <ActionButton action={setApprovalAction.bind(null, video.id, "approved")} success="Video approved">
                  <Check className="size-3.5" aria-hidden /> Approve
                </ActionButton>
              </>
            ) : null}
          </>
        }
      />
      <PageBody>
        {video.lastError ? (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
            <div>
              <p>{video.lastError}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Fix the cause, then retry the failed job in the{" "}
                <Link href="/queue" className="text-primary hover:underline">
                  production queue
                </Link>
                .
              </p>
            </div>
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(240px,340px)_1fr]">
          <div className="space-y-4">
            <VideoPreview renderAssetId={renderIsCurrent ? render.mediaAssetId : null} spec={video.timeline} assetUrls={assetUrls} />
            {render?.qaReport ? (
              <Panel title="Quality checks">
                <ul className="divide-y divide-border">
                  {render.qaReport.map((check) => (
                    <li key={check.key} className="flex items-start gap-2 px-4 py-2 text-sm">
                      {check.passed ? <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-label="Passed" /> : <TriangleAlert className={`mt-0.5 size-3.5 shrink-0 ${check.blocking ? "text-destructive" : "text-[color:var(--warning)]"}`} aria-label={check.blocking ? "Failed" : "Warning"} />}
                      <span className="min-w-0">
                        <span>{check.label}</span>
                        <span className="readout block text-xs text-muted-foreground">{check.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}
          </div>

          <div className="min-w-0 space-y-6">
            {idea && idea.facts.length > 0 ? (
              <Panel title="Research" description="Supported means a stored source states it. Check important claims yourself before publishing.">
                <ul className="divide-y divide-border">
                  {idea.facts.map((fact, index) => (
                    <li key={index} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                      <StatusPill tone={fact.status === "supported" ? "good" : "warn"}>{fact.status === "supported" ? "Supported" : "Uncertain"}</StatusPill>
                      <span className="min-w-0 flex-1 text-muted-foreground">
                        {fact.claim}{" "}
                        {fact.sourceIds.map((sourceId) => {
                          const source = idea.sources.find((s) => s.id === sourceId);
                          return source ? (
                            <a key={sourceId} href={source.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                              [{source.title}]
                            </a>
                          ) : null;
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}

            {script ? (
              <Panel title="Script" description={script.origin === "ai" ? "AI-written from the research above." : "Your own script."}>
                {script.hook ? <p className="border-b border-border px-4 py-2 text-sm"><span className="text-muted-foreground">Hook: </span>{script.hook}</p> : null}
                {script.callToAction ? <p className="border-b border-border px-4 py-2 text-sm"><span className="text-muted-foreground">Ending: </span>{script.callToAction}</p> : null}
                <SceneList
                  busy={busy}
                  estimatedCaptions={estimatedCaptions}
                  scenes={scenes.map((scene) => ({ id: scene.id, position: scene.position, narration: scene.narration, visualQuery: scene.visualQuery, durationSeconds: scene.durationSeconds, hasFootage: Boolean(scene.visualAssetId), hasVoice: Boolean(scene.narrationAssetId) }))}
                />
              </Panel>
            ) : null}

            {licenses.length > 0 ? (
              <Panel title="Footage licenses">
                <ul className="divide-y divide-border">
                  {licenses.map((license, index) => (
                    <li key={index} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                      <span className="text-muted-foreground">{license.attribution}</span>
                      <span className="flex items-center gap-2 text-xs">
                        <StatusPill>{license.license}</StatusPill>
                        {license.sourceUrl ? (
                          <a href={license.sourceUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                            Source
                          </a>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}

            <Panel title="Production history">
              {jobs.length === 0 ? (
                <EmptyState title="No jobs have run for this video yet" />
              ) : (
                <ul className="divide-y divide-border">
                  {jobs.map((job) => (
                    <li key={job.id} className="px-4 py-2.5">
                      <div className="flex items-center gap-3 text-sm">
                        <span className="min-w-0 flex-1 truncate">{job.label}</span>
                        <span className="readout hidden shrink-0 text-xs text-muted-foreground sm:block">{formatRelative(job.finishedAt ?? job.createdAt)}</span>
                        <JobStatus status={job.status} />
                      </div>
                      {job.status === "running" ? <div className="mt-2 h-1 overflow-hidden rounded bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${Math.round(job.progress * 100)}%` }} /></div> : null}
                      {job.errorMessage ? <p className="mt-1 text-xs text-destructive">{job.errorMessage}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      </PageBody>
    </>
  );
}
