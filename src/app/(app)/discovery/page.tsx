import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import Link from "next/link";
import { DiscoveryCard } from "@/components/discovery-card";
import { DiscoverySearchForm } from "@/components/discovery-search";
import { EmptyState, JobStatus, PageBody, PageHeader, Panel, SetupNotice } from "@/components/kit";
import { LiveRefresh } from "@/components/live";
import { ProjectPicker } from "@/components/project-picker";
import { buttonVariants } from "@/components/ui/button";
import { discoveredVideos, productionJobs } from "@/db/schema";
import { listProjects, query } from "@/server/context";
import { hasLlm, hasYoutube } from "@/services/registry";

export const metadata = { title: "AI Discovery" };

export default async function DiscoveryPage({ searchParams }: { searchParams: Promise<{ project?: string; view?: string }> }) {
  const params = await searchParams;
  const projects = await listProjects();
  if (projects.length === 0) {
    return (
      <>
        <PageHeader title="AI Discovery" />
        <PageBody>
          <Panel>
            <EmptyState title="Create a project first" action={<Link href="/projects/new" className={buttonVariants()}>Create project</Link>}>
              Discovery searches for your project&apos;s niche and keywords.
            </EmptyState>
          </Panel>
        </PageBody>
      </>
    );
  }
  const project = projects.find((p) => p.id === params.project) ?? projects[0];
  const saved = params.view === "saved";
  const { videos, jobs } = await query(async (tx, ctx) => ({
    videos: await tx
      .select()
      .from(discoveredVideos)
      .where(and(eq(discoveredVideos.workspaceId, ctx.workspaceId), eq(discoveredVideos.projectId, project.id), saved ? eq(discoveredVideos.status, "saved") : ne(discoveredVideos.status, "dismissed")))
      .orderBy(sql`${discoveredVideos.opportunityScore} desc nulls last`, desc(discoveredVideos.createdAt))
      .limit(60),
    jobs: await tx
      .select()
      .from(productionJobs)
      .where(and(eq(productionJobs.workspaceId, ctx.workspaceId), eq(productionJobs.projectId, project.id), eq(productionJobs.kind, "discovery.search"), inArray(productionJobs.status, ["queued", "running", "failed"])))
      .orderBy(desc(productionJobs.createdAt))
      .limit(3),
  }));
  const youtube = hasYoutube();

  return (
    <>
      <LiveRefresh active={jobs.some((job) => job.status !== "failed")} />
      <PageHeader title="AI Discovery" description="Find relevant YouTube videos and topics. This uses metadata from the official API, and no footage is downloaded." actions={<ProjectPicker projects={projects} current={project.id} />} />
      <PageBody>
        {!youtube ? (
          <SetupNotice title="Add a YouTube API key to search" envVars={["YOUTUBE_API_KEY"]}>
            Discovery reads public video metadata through the YouTube Data API. Keys are free in Google Cloud.
          </SetupNotice>
        ) : null}
        {youtube && !hasLlm() ? (
          <SetupNotice title="Scores are partial without OpenAI" envVars={["OPENAI_API_KEY"]}>
            Results are scored on freshness, engagement and novelty only. Add a key to assess relevance and hook potential.
          </SetupNotice>
        ) : null}
        <DiscoverySearchForm projectId={project.id} disabled={!youtube} defaultQuery={project.niche} />
        {jobs.map((job) => (
          <div key={job.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 text-sm">
            <JobStatus status={job.status} />
            <span className="min-w-0 flex-1 truncate">{job.label}</span>
            {job.errorMessage ? <span className="w-full text-xs text-destructive">{job.errorMessage}</span> : null}
          </div>
        ))}
        <div className="flex gap-1 text-sm">
          <Link href={`/discovery?project=${project.id}`} className={buttonVariants({ variant: saved ? "ghost" : "secondary", size: "sm" })}>
            All results
          </Link>
          <Link href={`/discovery?project=${project.id}&view=saved`} className={buttonVariants({ variant: saved ? "secondary" : "ghost", size: "sm" })}>
            Saved
          </Link>
        </div>
        {videos.length === 0 ? (
          <Panel>
            <EmptyState title={saved ? "Nothing saved yet" : "No results yet"}>{saved ? "Save a result to keep it for this project." : youtube ? "Run a search to fill this list." : "Results appear here once YouTube is connected."}</EmptyState>
          </Panel>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {videos.map((video) => (
              <DiscoveryCard key={video.id} video={{ ...video, publishedAt: video.publishedAt?.toISOString() ?? null }} />
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
