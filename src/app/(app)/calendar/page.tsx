import { and, eq, gte, lt } from "drizzle-orm";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { PageBody, PageHeader, Panel, SetupNotice } from "@/components/kit";
import { buttonVariants } from "@/components/ui/button";
import { renderedVideos, scheduledPosts, videoProjects } from "@/db/schema";
import { cn } from "@/lib/utils";
import { query } from "@/server/context";

export const metadata = { title: "Content Calendar" };

const STATUS_STYLE: Record<string, string> = {
  pending_approval: "border-[color:var(--warning)]/50 text-[color:var(--warning)]",
  approved: "border-primary/50 text-primary",
  failed: "border-destructive/50 text-destructive",
};

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const params = await searchParams;
  const now = new Date();
  const parsed = params.month?.match(/^(\d{4})-(\d{2})$/);
  const first = parsed ? new Date(Number(parsed[1]), Number(parsed[2]) - 1, 1) : new Date(now.getFullYear(), now.getMonth(), 1);
  const next = new Date(first.getFullYear(), first.getMonth() + 1, 1);
  const prev = new Date(first.getFullYear(), first.getMonth() - 1, 1);
  const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

  const { renders, scheduled } = await query(async (tx, ctx) => ({
    renders: await tx
      .select({ id: videoProjects.id, title: videoProjects.title, status: videoProjects.status, at: renderedVideos.createdAt })
      .from(renderedVideos)
      .innerJoin(videoProjects, eq(videoProjects.id, renderedVideos.videoProjectId))
      .where(and(eq(renderedVideos.workspaceId, ctx.workspaceId), gte(renderedVideos.createdAt, first), lt(renderedVideos.createdAt, next))),
    scheduled: await tx
      .select({ id: videoProjects.id, title: videoProjects.title, platform: scheduledPosts.platform, at: scheduledPosts.scheduledFor })
      .from(scheduledPosts)
      .innerJoin(videoProjects, eq(videoProjects.id, scheduledPosts.videoProjectId))
      .where(and(eq(scheduledPosts.workspaceId, ctx.workspaceId), gte(scheduledPosts.scheduledFor, first), lt(scheduledPosts.scheduledFor, next))),
  }));

  const leading = first.getDay();
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const entries = (day: number) => [
    ...scheduled.filter((item) => item.at.getDate() === day).map((item) => ({ id: item.id, title: item.title, label: item.platform, style: "border-[#77A9FF]/50 text-[#77A9FF]" })),
    ...renders.filter((item) => item.at.getDate() === day).map((item) => ({ id: item.id, title: item.title, label: null as string | null, style: STATUS_STYLE[item.status] ?? "border-border text-muted-foreground" })),
  ];
  const isToday = (day: number) => first.getFullYear() === now.getFullYear() && first.getMonth() === now.getMonth() && day === now.getDate();

  return (
    <>
      <PageHeader
        title="Content Calendar"
        description="When each video was rendered, and what's scheduled to go out."
        actions={
          <div className="flex items-center gap-1">
            <Link href={`/calendar?month=${key(prev)}`} aria-label="Previous month" className={buttonVariants({ variant: "ghost", size: "icon" })}><ChevronLeft className="size-4" /></Link>
            <span className="readout w-32 text-center text-sm">{first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
            <Link href={`/calendar?month=${key(next)}`} aria-label="Next month" className={buttonVariants({ variant: "ghost", size: "icon" })}><ChevronRight className="size-4" /></Link>
          </div>
        }
      />
      <PageBody>
        <SetupNotice title="Scheduling arrives in Phase 2">Drag-and-drop scheduling, plus weekly and daily views, come with social publishing. This month view already shows your real renders.</SetupNotice>
        <Panel>
          <div className="overflow-x-auto">
            <div className="grid min-w-[640px] grid-cols-7">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div key={day} className="border-b border-border px-2 py-1.5 text-xs text-muted-foreground">{day}</div>)}
              {Array.from({ length: leading }, (_, i) => <div key={`blank-${i}`} className="min-h-24 border-r border-b border-border/50 bg-background/30" />)}
              {Array.from({ length: days }, (_, i) => i + 1).map((day) => (
                <div key={day} className="min-h-24 border-r border-b border-border/50 p-1.5">
                  <div className={cn("readout mb-1 text-xs text-muted-foreground", isToday(day) && "font-medium text-primary")}>{day}</div>
                  <div className="space-y-1">
                    {entries(day).slice(0, 4).map((entry, index) => (
                      <Link key={`${entry.id}-${index}`} href={`/videos/${entry.id}`} title={entry.title} className={cn("block truncate rounded border px-1 py-0.5 text-[11px] hover:bg-muted/40", entry.style)}>{entry.label ? `${entry.label}: ` : ""}{entry.title}</Link>
                    ))}
                    {entries(day).length > 4 ? <p className="text-[11px] text-muted-foreground">+{entries(day).length - 4} more</p> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </PageBody>
    </>
  );
}
