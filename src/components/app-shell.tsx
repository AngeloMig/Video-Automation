"use client";

import {
  Activity,
  BarChart3,
  Bot,
  CalendarDays,
  CreditCard,
  FolderKanban,
  LayoutDashboard,
  Link2,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Radar,
  ScissorsLineDashed,
  Send,
  Settings,
  Shapes,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { RelayMark } from "@/components/relay-mark";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { logoutAction } from "@/server/actions";

const NAV = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/discovery", label: "AI Discovery", icon: Radar },
  { href: "/projects", label: "Content Projects", icon: FolderKanban },
  { href: "/clipper", label: "AI Clipper", icon: ScissorsLineDashed },
  { href: "/faceless", label: "Faceless Creator", icon: Sparkles },
  { href: "/editor", label: "Video Editor", icon: SlidersHorizontal },
  { href: "/queue", label: "Production Queue", icon: Activity },
  { href: "/calendar", label: "Content Calendar", icon: CalendarDays },
  { href: "/published", label: "Published Videos", icon: Send },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/agents", label: "AI Agents", icon: Bot },
  { href: "/accounts", label: "Connected Accounts", icon: Link2 },
  { href: "/templates", label: "Templates", icon: Shapes },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/billing", label: "Billing", icon: CreditCard },
] as const;

const useSidebar = create<{ collapsed: boolean; toggle: () => void }>()(
  persist((set) => ({ collapsed: false, toggle: () => set((state) => ({ collapsed: !state.collapsed })) }), { name: "relay-sidebar" }),
);

export type ShellStatus = { activeJobs: number; pendingApprovals: number; workerOnline: boolean; workspaceName: string; email: string };

function NavLinks({ collapsed, pendingApprovals, activeJobs, onNavigate }: { collapsed: boolean; pendingApprovals: number; activeJobs: number; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        const count = href === "/queue" ? activeJobs : href === "/published" ? pendingApprovals : 0;
        const link = (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            aria-label={collapsed ? label : undefined}
            className={cn(
              "group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground",
              active && "bg-sidebar-accent text-foreground",
              collapsed && "justify-center px-0",
            )}
          >
            <Icon className={cn("size-4 shrink-0", active && "text-primary")} aria-hidden />
            {collapsed ? null : <span className="truncate">{label}</span>}
            {count > 0 && !collapsed ? <span className="readout ml-auto text-[11px] text-primary">{count}</span> : null}
          </Link>
        );
        if (!collapsed) return link;
        return (
          <Tooltip key={href}>
            <TooltipTrigger render={link} />
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
  );
}

function WorkerStatus({ online, activeJobs, collapsed }: { online: boolean; activeJobs: number; collapsed: boolean }) {
  const label = !online ? "Worker offline" : activeJobs > 0 ? `${activeJobs} running or queued` : "Worker idle";
  return (
    <div className={cn("flex items-center gap-2 px-2.5 text-xs text-muted-foreground", collapsed && "justify-center px-0")} title={label}>
      <span className="relative flex size-2">
        {online && activeJobs > 0 ? <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" /> : null}
        <span className={cn("relative inline-flex size-2 rounded-full", online ? "bg-primary" : "bg-destructive")} />
      </span>
      {collapsed ? <span className="sr-only">{label}</span> : <span>{label}</span>}
    </div>
  );
}

export function AppShell({ status, children }: { status: ShellStatus; children: React.ReactNode }) {
  const { collapsed, toggle } = useSidebar();
  // The saved preference only exists in the browser, so the server always renders it expanded.
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const isCollapsed = hydrated && collapsed;

  return (
    <div className="flex min-h-dvh">
      <aside
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 md:flex",
          isCollapsed ? "w-14" : "w-60",
        )}
      >
        <div className={cn("flex h-14 items-center px-4", isCollapsed && "justify-center px-0")}>
          <Link href="/overview" aria-label="Relay home">
            <RelayMark collapsed={isCollapsed} />
          </Link>
        </div>
        <NavLinks collapsed={isCollapsed} pendingApprovals={status.pendingApprovals} activeJobs={status.activeJobs} />
        <div className="space-y-2 border-t border-sidebar-border py-3">
          <WorkerStatus online={status.workerOnline} activeJobs={status.activeJobs} collapsed={isCollapsed} />
          {isCollapsed ? null : (
            <div className="truncate px-2.5 text-xs text-muted-foreground" title={status.email}>
              {status.workspaceName}
            </div>
          )}
          <div className={cn("flex items-center px-1.5", isCollapsed ? "flex-col gap-1" : "justify-between")}>
            <button type="button" onClick={toggle} aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"} className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
              {isCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            </button>
            <form action={logoutAction}>
              <button type="submit" aria-label="Sign out" className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
                <LogOut className="size-4" />
              </button>
            </form>
          </div>
        </div>
      </aside>

      <header className="fixed inset-x-0 top-0 z-30 flex h-12 items-center justify-between border-b border-border bg-sidebar px-3 md:hidden">
        <RelayMark />
        <button type="button" onClick={() => setMobileOpen(true)} aria-label="Open menu" className="grid size-9 place-items-center rounded-md hover:bg-sidebar-accent">
          <Menu className="size-5" />
        </button>
      </header>
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-sidebar-border bg-sidebar">
            <div className="flex h-12 items-center justify-between px-3">
              <RelayMark />
              <button type="button" onClick={() => setMobileOpen(false)} aria-label="Close menu" className="grid size-9 place-items-center rounded-md hover:bg-sidebar-accent">
                <X className="size-5" />
              </button>
            </div>
            <NavLinks collapsed={false} pendingApprovals={status.pendingApprovals} activeJobs={status.activeJobs} onNavigate={() => setMobileOpen(false)} />
            <div className="space-y-2 border-t border-sidebar-border py-3">
              <WorkerStatus online={status.workerOnline} activeJobs={status.activeJobs} collapsed={false} />
              <form action={logoutAction} className="px-1.5">
                <button type="submit" className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:bg-sidebar-accent">
                  <LogOut className="size-4" /> Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}

      <main className="min-w-0 flex-1 pt-12 md:pt-0">
        {!status.workerOnline ? (
          <div role="status" className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm md:px-8">
            <span className="font-medium">The worker isn&apos;t running.</span> Jobs stay queued until it starts. Run <code className="readout text-[13px]">pnpm worker</code>.
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
