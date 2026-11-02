import { and, desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { SourceUploadForm } from "@/components/source-upload-form";
import { EmptyState, formatDuration, formatRelative, PageBody, PageHeader, Panel, SetupNotice, StatusPill } from "@/components/kit";
import { ProjectPicker } from "@/components/project-picker";
import { buttonVariants } from "@/components/ui/button";
import { mediaAssets, sourceAssets, transcripts, videoProjects } from "@/db/schema";
import { listProjects, query } from "@/server/context";
import { hasLlm } from "@/services/registry";

export const metadata = { title: "AI Clipper" };

export default async function ClipperPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const params = await searchParams;
  const projects = await listProjects();
  if (projects.length === 0) {
    return (
      <>
        <PageHeader title="AI Clipper" />
        <PageBody>
          <Panel>
            <EmptyState title="Create a project first" action={<Link href="/projects/new" className={buttonVariants()}>Create project</Link>}>
              Each source video belongs to a project, which sets its branding and clip style.
            </EmptyState>
          </Panel>
        </PageBody>
      </>
    );
  }
  const project = projects.find((p) => p.id === params.project) ?? projects.find((p) => p.mode === "clipper") ?? projects[0];
  const sources = await query((tx, ctx) =>
    tx
      .select({
        source: sourceAssets,
        media: mediaAssets,
        transcribed: sql<boolean>`exists (select 1 from ${transcripts} t where t.source_asset_id = ${sourceAssets.id})`,
        clips: sql<number>`(select count(*)::int from ${videoProjects} v where v.source_asset_id = ${sourceAssets.id})`,
      })
      .from(sourceAssets)
      .innerJoin(mediaAssets, eq(mediaAssets.id, sourceAssets.mediaAssetId))
      .where(and(eq(sourceAssets.workspaceId, ctx.workspaceId), eq(sourceAssets.projectId, project.id)))
      .orderBy(desc(sourceAssets.createdAt)),
  );

  return (
    <>
      <PageHeader
        title="AI Clipper"
        description="Upload long videos you have the rights to. Find the strongest moments, then cut them into vertical clips."
        actions={<ProjectPicker projects={projects} current={project.id} />}
      />
      <PageBody>
        {!hasLlm() ? (
          <SetupNotice title="Automatic transcription and highlights need OpenAI" envVars={["OPENAI_API_KEY"]}>
            You can still upload a video and cut clips by timecode.
          </SetupNotice>
        ) : null}
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <SourceUploadForm projectId={project.id} />
          </div>
          <Panel title="Source videos" className="lg:col-span-3">
            {sources.length === 0 ? (
              <EmptyState title="No source videos yet">Upload a video to find clips in it. YouTube links can&apos;t be downloaded here, so use AI Discovery to research them instead.</EmptyState>
            ) : (
              <ul className="divide-y divide-border">
                {sources.map(({ source, media, transcribed, clips }) => (
                  <li key={source.id}>
                    <Link href={`/clipper/${source.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{source.title}</p>
                        <p className="readout mt-0.5 text-xs text-muted-foreground">
                          {formatDuration(media.durationSeconds)} · {clips} {clips === 1 ? "clip" : "clips"} · {formatRelative(source.createdAt)}
                        </p>
                      </div>
                      <StatusPill tone={transcribed ? "good" : "neutral"}>{transcribed ? "Transcribed" : "Not transcribed"}</StatusPill>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </PageBody>
    </>
  );
}
