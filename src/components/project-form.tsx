"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { fieldClass, onFormSubmit, Panel } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createProjectAction, updateProjectAction } from "@/server/actions";
import type { ProjectInput } from "@/server/domain";
import { TEMPLATES } from "@/timeline/build";

export const TONES = ["educational", "cinematic", "documentary", "energetic", "conversational", "professional", "storytelling"];
export const DURATIONS = [15, 30, 45, 60];

const splitList = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export function ProjectForm({ projectId, initial }: { projectId?: string; initial?: Partial<ProjectInput> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<ProjectInput["mode"]>(initial?.mode ?? "faceless");

  function submit(form: FormData) {
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const input: ProjectInput = {
      name: text("name"),
      niche: text("niche"),
      targetAudience: text("targetAudience") || undefined,
      language: text("language") || "en",
      region: text("region") || undefined,
      mode,
      keywords: splitList(text("keywords")),
      excludedKeywords: splitList(text("excludedKeywords")),
      preferredDurationSeconds: Number(text("duration")),
      productionTargetPerWeek: Number(text("target")),
      brandPrimary: text("brandPrimary"),
      brandSecondary: text("brandSecondary"),
      template: text("template") as ProjectInput["template"],
      tone: text("tone"),
    };
    start(async () => {
      if (projectId) {
        const result = await updateProjectAction(projectId, input);
        if (!result.ok) return void toast.error(result.error);
        toast.success("Project saved");
        router.refresh();
      } else {
        const result = await createProjectAction(input);
        if (!result.ok) return void toast.error(result.error);
        router.push(input.mode === "clipper" ? `/clipper?project=${result.data}` : `/faceless?project=${result.data}`);
      }
    });
  }

  return (
    <form onSubmit={onFormSubmit(submit)} className="space-y-6">
      <Panel title="Niche and audience">
        <div className="grid gap-4 p-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="name">Project name</Label>
            <Input id="name" name="name" required defaultValue={initial?.name} placeholder="Cosmos Daily" className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="niche">Niche or industry</Label>
            <Input id="niche" name="niche" required defaultValue={initial?.niche} placeholder="Space exploration" className="h-9" />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="targetAudience">Target audience</Label>
            <Textarea id="targetAudience" name="targetAudience" rows={2} defaultValue={initial?.targetAudience} placeholder="Curious adults who like big ideas explained simply" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="language">Content language</Label>
            <Input id="language" name="language" defaultValue={initial?.language ?? "en"} className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="region">Geographic focus</Label>
            <Input id="region" name="region" maxLength={2} defaultValue={initial?.region} placeholder="US" className="h-9" />
            <p className="text-xs text-muted-foreground">Two-letter country code. Leave blank for worldwide.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="keywords">Search keywords</Label>
            <Input id="keywords" name="keywords" defaultValue={initial?.keywords?.join(", ")} placeholder="mars, black holes, nasa" className="h-9" />
            <p className="text-xs text-muted-foreground">Separate with commas.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="excludedKeywords">Excluded keywords</Label>
            <Input id="excludedKeywords" name="excludedKeywords" defaultValue={initial?.excludedKeywords?.join(", ")} placeholder="astrology" className="h-9" />
          </div>
        </div>
      </Panel>

      <Panel title="How videos get made">
        <div className="space-y-4 p-4">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Content mode</legend>
            <div className="grid gap-2 md:grid-cols-2">
              {(
                [
                  ["faceless", "Faceless Creator", "Researches a topic, writes an original script, then adds narration and B-roll."],
                  ["clipper", "AI Clipper", "Finds the best moments in long videos you have the rights to, and cuts them vertical."],
                ] as const
              ).map(([value, title, description]) => (
                <label key={value} className={`cursor-pointer rounded-md border p-3 transition-colors ${mode === value ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40"}`}>
                  <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="sr-only" />
                  <span className="block text-sm font-medium">{title}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="duration">Video length</Label>
              <select id="duration" name="duration" defaultValue={initial?.preferredDurationSeconds ?? 30} className={fieldClass}>
                {DURATIONS.map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {seconds} seconds
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="target">Videos per week</Label>
              <Input id="target" name="target" type="number" min={0} max={100} defaultValue={initial?.productionTargetPerWeek ?? 3} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tone">Tone</Label>
              <select id="tone" name="tone" defaultValue={initial?.tone ?? "educational"} className={fieldClass}>
                {TONES.map((tone) => (
                  <option key={tone} value={tone}>
                    {tone[0].toUpperCase() + tone.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="template">Editing template</Label>
              <select id="template" name="template" defaultValue={initial?.template ?? "signal"} className={fieldClass}>
                {TEMPLATES.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="Brand colors" description="Used for caption highlights and on-screen text.">
        <div className="flex flex-wrap gap-6 p-4">
          {(
            [
              ["brandPrimary", "Primary", initial?.brandPrimary ?? "#58D5C9"],
              ["brandSecondary", "Secondary", initial?.brandSecondary ?? "#77A9FF"],
            ] as const
          ).map(([name, label, value]) => (
            <div key={name} className="flex items-center gap-2">
              <input id={name} name={name} type="color" defaultValue={value} className="size-9 cursor-pointer rounded-md border border-input bg-transparent p-0.5" />
              <Label htmlFor={name}>{label}</Label>
            </div>
          ))}
        </div>
      </Panel>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Finished videos always wait for your approval. Autonomous publishing is opt-in and arrives in Phase 2.</p>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : projectId ? "Save changes" : "Create project"}
        </Button>
      </div>
    </form>
  );
}
