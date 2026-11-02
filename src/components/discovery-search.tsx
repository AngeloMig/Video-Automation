"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { fieldClass, onFormSubmit } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { startDiscoveryAction } from "@/server/actions";

export function DiscoverySearchForm({ projectId, disabled, defaultQuery }: { projectId: string; disabled: boolean; defaultQuery: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-2 rounded-lg border border-border bg-card p-3 md:grid-cols-[1fr_1fr_140px_140px_auto]"
      onSubmit={onFormSubmit((form) =>
        start(async () => {
          const days = Number(form.get("days"));
          const result = await startDiscoveryAction({
            projectId,
            query: String(form.get("query") ?? "").trim() || undefined,
            url: String(form.get("url") ?? "").trim() || undefined,
            publishedAfterDays: days || undefined,
            duration: String(form.get("duration")) as "any",
          });
          if (!result.ok) return void toast.error(result.error);
          router.refresh();
        }),
      )}
    >
      <Input name="query" aria-label="Search keywords" defaultValue={defaultQuery} placeholder="Search keywords" className="h-9" disabled={disabled} />
      <Input name="url" aria-label="YouTube link" placeholder="Or paste a YouTube link to analyze" className="h-9" disabled={disabled} />
      <select name="days" aria-label="Published within" defaultValue="90" className={fieldClass} disabled={disabled}>
        <option value="7">Past week</option>
        <option value="30">Past month</option>
        <option value="90">Past 3 months</option>
        <option value="365">Past year</option>
        <option value="0">Any time</option>
      </select>
      <select name="duration" aria-label="Video length" defaultValue="any" className={fieldClass} disabled={disabled}>
        <option value="any">Any length</option>
        <option value="short">Under 4 min</option>
        <option value="medium">4–20 min</option>
        <option value="long">Over 20 min</option>
      </select>
      <Button type="submit" className="h-9" disabled={disabled || pending}>
        Search
      </Button>
    </form>
  );
}
