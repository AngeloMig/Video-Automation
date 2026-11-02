import { desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { EmptyState, formatRelative, PageBody, PageHeader, Panel, StatusPill } from "@/components/kit";
import { buttonVariants } from "@/components/ui/button";
import { projects, videoProjects } from "@/db/schema";
import { query } from "@/server/context";

export const metadata = { title: "Content Projects" };

export default async function ProjectsPage() {
  const rows = await query((tx, ctx) =>
    tx
      .select({
        project: projects,
        videos: sql<number>`(select count(*)::int from ${videoProjects} v where v.project_id = ${projects.id})`,
      })
      .from(projects)
      .where(sql`${eq(projects.workspaceId, ctx.workspaceId)} and ${projects.archivedAt} is null`)
      .orderBy(desc(projects.createdAt)),
  );
  return (
    <>
      <PageHeader
        title="Content Projects"
        description="Each project keeps its own queue, branding and results."
        actions={
          <Link href="/projects/new" className={buttonVariants()}>
            New project
          </Link>
        }
      />
      <PageBody>
        {rows.length === 0 ? (
          <Panel>
            <EmptyState title="No projects yet" action={<Link href="/projects/new" className={buttonVariants()}>Create project</Link>}>
              Create a project for each niche or channel you want to produce for.
            </EmptyState>
          </Panel>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map(({ project, videos }) => (
              <Link key={project.id} href={`/projects/${project.id}`} className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="truncate text-sm font-medium">{project.name}</h2>
                  <StatusPill tone={project.mode === "clipper" ? "info" : "active"}>{project.mode === "clipper" ? "AI Clipper" : "Faceless"}</StatusPill>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{project.niche}</p>
                <p className="readout mt-3 text-xs text-muted-foreground">
                  {videos} {videos === 1 ? "video" : "videos"} · created {formatRelative(project.createdAt)}
                </p>
              </Link>
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
