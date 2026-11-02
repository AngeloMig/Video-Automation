import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { FacelessForm } from "@/components/faceless-form";
import { EmptyState, formatDuration, formatRelative, PageBody, PageHeader, Panel, VideoStatus } from "@/components/kit";
import { LiveRefresh } from "@/components/live";
import { ProjectPicker } from "@/components/project-picker";
import { buttonVariants } from "@/components/ui/button";
import { discoveredVideos, projectSettings, videoProjects } from "@/db/schema";
import { listProjects, query } from "@/server/context";
import { hasLlm } from "@/services/registry";

export const metadata = { title: "Faceless Creator" };

export default async function FacelessPage({ searchParams }: { searchParams: Promise<{ project?: string; topic?: string; from?: string }> }) {
  const params = await searchParams;
  const projects = await listProjects();
  if (projects.length === 0) {
    return (
      <>
        <PageHeader title="Faceless Creator" />
        <PageBody>
          <Panel>
            <EmptyState title="Create a project first" action={<Link href="/projects/new" className={buttonVariants()}>Create project</Link>}>
              Each video belongs to a project, which sets its language, branding and voice.
            </EmptyState>
          </Panel>
        </PageBody>
      </>
    );
  }
  const project = projects.find((p) => p.id === params.project) ?? projects.find((p) => p.mode === "faceless") ?? projects[0];
  const { videos, settings, source } = await query(async (tx, ctx) => ({
    videos: await tx
      .select()
      .from(videoProjects)
      .where(and(eq(videoProjects.workspaceId, ctx.workspaceId), eq(videoProjects.projectId, project.id), eq(videoProjects.mode, "faceless")))
      .orderBy(desc(videoProjects.createdAt))
      .limit(40),
    settings: (await tx.select().from(projectSettings).where(eq(projectSettings.projectId, project.id)))[0],
    source: params.from
      ? (await tx.select().from(discoveredVideos).where(and(eq(discoveredVideos.id, params.from), eq(discoveredVideos.workspaceId, ctx.workspaceId))))[0]
      : undefined,
  }));
  const active = videos.some((video) => video.status === "in_production" || video.status === "rendering");

  return (
    <>
      <LiveRefresh active={active} />
      <PageHeader
        title="Faceless Creator"
        description="Original videos from a topic or your own script: narration, B-roll, captions and an MP4 ready to review."
        actions={<ProjectPicker projects={projects} current={project.id} />}
      />
      <PageBody>
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <FacelessForm
              projectId={project.id}
              aiAvailable={hasLlm()}
              defaultDuration={settings.preferredDurationSeconds}
              defaultTone={settings.tone}
              initialTopic={params.topic ?? source?.title}
              discoveredVideoId={source?.id}
            />
          </div>
          <Panel title="Videos in this project" className="lg:col-span-3">
            {videos.length === 0 ? (
              <EmptyState title="No videos yet">Enter a topic or paste a script to start your first one.</EmptyState>
            ) : (
              <ul className="divide-y divide-border">
                {videos.map((video) => (
                  <li key={video.id}>
                    <Link href={`/videos/${video.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{video.title}</p>
                        <p className="readout mt-0.5 truncate text-xs text-muted-foreground">
                          {video.timeline ? formatDuration(video.timeline.durationInFrames / video.timeline.fps) : `${video.targetDurationSeconds ?? "–"}s target`} · {formatRelative(video.createdAt)}
                        </p>
                        {video.lastError ? <p className="mt-1 line-clamp-2 text-xs text-destructive">{video.lastError}</p> : null}
                      </div>
                      <VideoStatus status={video.status} />
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
