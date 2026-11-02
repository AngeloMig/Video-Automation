import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ProjectAssets } from "@/components/project-assets";
import { ActionButton } from "@/components/live";
import { PageBody, PageHeader } from "@/components/kit";
import { ProjectForm } from "@/components/project-form";
import { mediaAssets, nicheKeywords, projects, projectSettings } from "@/db/schema";
import { archiveProjectAction } from "@/server/actions";
import { isUuid } from "@/server/api";
import { query } from "@/server/context";

export const metadata = { title: "Project" };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await query(async (tx, ctx) => {
    const [project] = await tx.select().from(projects).where(and(eq(projects.id, id), eq(projects.workspaceId, ctx.workspaceId)));
    if (!project) return null;
    const [settings] = await tx.select().from(projectSettings).where(eq(projectSettings.projectId, id));
    const keywords = await tx.select().from(nicheKeywords).where(eq(nicheKeywords.projectId, id));
    const assets = await tx.select().from(mediaAssets).where(and(eq(mediaAssets.projectId, id), eq(mediaAssets.status, "ready")));
    return { project, settings, keywords, assets };
  });
  if (!data) notFound();
  const { project, settings, keywords, assets } = data;
  return (
    <>
      <PageHeader
        title={project.name}
        description={project.niche}
        actions={
          <ActionButton variant="outline" action={archiveProjectAction.bind(null, id)} confirm={`Archive ${project.name}? Its videos stay in your workspace.`} success="Project archived">
            Archive project
          </ActionButton>
        }
      />
      <PageBody className="max-w-4xl">
        <ProjectForm
          projectId={id}
          initial={{
            name: project.name,
            niche: project.niche,
            targetAudience: project.targetAudience ?? undefined,
            language: project.language,
            region: project.region ?? undefined,
            mode: project.mode,
            keywords: keywords.filter((k) => !k.excluded).map((k) => k.keyword),
            excludedKeywords: keywords.filter((k) => k.excluded).map((k) => k.keyword),
            preferredDurationSeconds: settings.preferredDurationSeconds,
            productionTargetPerWeek: settings.productionTargetPerWeek,
            brandPrimary: settings.brandPrimary,
            brandSecondary: settings.brandSecondary,
            template: settings.template as "signal",
            tone: settings.tone,
          }}
        />
        <ProjectAssets
          projectId={id}
          logoAssetId={settings.logoAssetId}
          musicAssetId={settings.musicAssetId}
          voiceId={settings.voiceId}
          voiceSpeed={settings.voiceSpeed}
          music={assets.filter((a) => a.kind === "music").map((a) => ({ id: a.id, name: a.filename ?? "Track" }))}
          logos={assets.filter((a) => a.kind === "logo").map((a) => ({ id: a.id, name: a.filename ?? "Logo" }))}
        />
      </PageBody>
    </>
  );
}
