import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Shared page furniture. These are server-safe, so client components can import them too. */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-6 pb-5 md:px-8">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("space-y-6 px-4 pb-12 md:px-8", className)}>{children}</div>;
}

export function Panel({ title, description, actions, children, className }: { title?: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border border-border bg-card", className)}>
      {title ? (
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-medium">{title}</h2>
            {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** A value of null renders as unavailable. Never pass 0 for something that wasn't measured. */
export function Stat({ label, value, hint, href }: { label: string; value: ReactNode | null; hint?: string; href?: string }) {
  const content = (
    <>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("readout mt-1.5 text-2xl font-medium", value === null && "text-base text-muted-foreground")}>{value === null ? "Unavailable" : value}</div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </>
  );
  const style = "block rounded-lg border border-border bg-card px-4 py-3";
  return href ? (
    <Link href={href} className={cn(style, "transition-colors hover:border-primary/40")}>
      {content}
    </Link>
  ) : (
    <div className={style}>{content}</div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children ? <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{children}</p> : null}
      {action ? <div className="mt-4 flex justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/** Shown wherever a feature needs a key that isn't set. Names the setting, never a secret value. */
export function SetupNotice({ title, children, envVars, className }: { title: string; children: ReactNode; envVars?: string[]; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-[color:var(--warning)]/30 bg-[color:var(--warning)]/5 px-4 py-3", className)}>
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {children}{" "}
        <Link href="/settings#integrations" className="text-primary underline-offset-4 hover:underline">
          Open integrations
        </Link>
      </p>
      {envVars?.length ? (
        <p className="mt-1.5 flex flex-wrap gap-1.5">
          {envVars.map((name) => (
            <code key={name} className="readout rounded bg-muted px-1.5 py-0.5 text-xs">
              {name}
            </code>
          ))}
        </p>
      ) : null}
    </div>
  );
}

const TONES: Record<string, string> = {
  neutral: "border-border text-muted-foreground",
  active: "border-primary/40 text-primary",
  info: "border-[#77A9FF]/40 text-[#77A9FF]",
  warn: "border-[color:var(--warning)]/40 text-[color:var(--warning)]",
  bad: "border-destructive/40 text-destructive",
  good: "border-primary/40 bg-primary/10 text-primary",
};

export function StatusPill({ tone = "neutral", children, pulse }: { tone?: keyof typeof TONES; children: ReactNode; pulse?: boolean }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium whitespace-nowrap", TONES[tone])}>
      {pulse ? <span className="size-1.5 animate-pulse rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

const VIDEO_STATUS: Record<string, { label: string; tone: keyof typeof TONES; pulse?: boolean }> = {
  draft: { label: "Draft", tone: "neutral" },
  candidate: { label: "Candidate", tone: "info" },
  in_production: { label: "In production", tone: "active", pulse: true },
  ready_to_render: { label: "Ready to render", tone: "info" },
  rendering: { label: "Rendering", tone: "active", pulse: true },
  pending_approval: { label: "Needs approval", tone: "warn" },
  approved: { label: "Approved", tone: "good" },
  rejected: { label: "Rejected", tone: "neutral" },
  failed: { label: "Failed", tone: "bad" },
};

export function VideoStatus({ status }: { status: string }) {
  const entry = VIDEO_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return (
    <StatusPill tone={entry.tone} pulse={entry.pulse}>
      {entry.label}
    </StatusPill>
  );
}

const JOB_STATUS: Record<string, { label: string; tone: keyof typeof TONES; pulse?: boolean }> = {
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Running", tone: "active", pulse: true },
  succeeded: { label: "Done", tone: "good" },
  failed: { label: "Failed", tone: "bad" },
  cancel_requested: { label: "Cancelling", tone: "warn", pulse: true },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export function JobStatus({ status }: { status: string }) {
  const entry = JOB_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return (
    <StatusPill tone={entry.tone} pulse={entry.pulse}>
      {entry.label}
    </StatusPill>
  );
}

/** Reads a form without React's action reset, so a failed submit never wipes what someone typed. */
export function onFormSubmit(handler: (form: FormData) => void) {
  return (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    handler(new FormData(event.currentTarget));
  };
}

export const fieldClass =
  "h-9 w-full rounded-md border border-input bg-input/30 px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

export function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return "–";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

export function formatRelative(date: Date | string | null | undefined) {
  if (!date) return "–";
  const then = new Date(date).getTime();
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86_400 * 30) return `${Math.floor(seconds / 86_400)}d ago`;
  return new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatCompact(value: number | null | undefined) {
  if (value === null || value === undefined) return "Hidden";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatUsd(microUsd: number) {
  const dollars = microUsd / 1_000_000;
  return dollars < 0.01 && dollars > 0 ? "<$0.01" : `$${dollars.toFixed(2)}`;
}
