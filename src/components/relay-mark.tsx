import { cn } from "@/lib/utils";

/** The mark is the product's pipeline: three stages joined by one signal. */
export function RelayMark({ className, collapsed }: { className?: string; collapsed?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 28 28" className="size-7 shrink-0" aria-hidden>
        <path d="M5 21 L14 7 L23 21" fill="none" stroke="#283647" strokeWidth="2" />
        <path d="M5 21 L14 7" fill="none" stroke="#58D5C9" strokeWidth="2" />
        <circle cx="5" cy="21" r="3" fill="#58D5C9" />
        <circle cx="14" cy="7" r="3" fill="#58D5C9" />
        <circle cx="23" cy="21" r="3" fill="#77A9FF" />
      </svg>
      {collapsed ? null : <span className="text-[15px] font-semibold tracking-tight">Relay</span>}
    </div>
  );
}
