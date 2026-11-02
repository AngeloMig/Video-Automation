"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { fieldClass, onFormSubmit, Panel, SetupNotice } from "@/components/kit";
import { DURATIONS, TONES } from "@/components/project-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { createFacelessAction } from "@/server/actions";

export function FacelessForm({
  projectId,
  aiAvailable,
  defaultDuration,
  defaultTone,
  initialTopic,
  discoveredVideoId,
}: {
  projectId: string;
  aiAvailable: boolean;
  defaultDuration: number;
  defaultTone: string;
  initialTopic?: string;
  discoveredVideoId?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [route, setRoute] = useState<"topic" | "script">(aiAvailable ? "topic" : "script");

  function submit(form: FormData) {
    const text = (name: string) => String(form.get(name) ?? "").trim();
    start(async () => {
      const result = await createFacelessAction({
        projectId,
        topic: route === "topic" ? text("topic") : undefined,
        script: route === "script" ? text("script") : undefined,
        title: text("title") || undefined,
        discoveredVideoId: route === "topic" ? discoveredVideoId : undefined,
        // A written script is as long as its narration, so length only applies to topics.
        durationSeconds: Number(text("duration")) || defaultDuration,
        tone: text("tone"),
      });
      if (!result.ok) return void toast.error(result.error);
      router.push(`/videos/${result.data}`);
    });
  }

  return (
    <Panel title="New video">
      <form onSubmit={onFormSubmit(submit)} className="space-y-4 p-4">
        <div role="tablist" aria-label="How to start" className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
          {(
            [
              ["topic", "From a topic"],
              ["script", "My own script"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={route === value}
              onClick={() => setRoute(value)}
              className={cn("h-7 rounded text-[13px] transition-colors", route === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {label}
            </button>
          ))}
        </div>

        {route === "topic" ? (
          aiAvailable ? (
            <div className="space-y-1.5">
              <Label htmlFor="topic">Topic</Label>
              <Textarea id="topic" name="topic" required rows={3} defaultValue={initialTopic} placeholder="Why Olympus Mons is the tallest volcano in the solar system" />
              <p className="text-xs text-muted-foreground">The Research Agent reads Wikipedia sources, then the script only uses facts those sources support.</p>
            </div>
          ) : (
            <SetupNotice title="Topic research needs OpenAI" envVars={["OPENAI_API_KEY"]}>
              Add a key to research topics and write scripts, or use your own script now.
            </SetupNotice>
          )
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="title">Title</Label>
              <Input id="title" name="title" placeholder="The tallest volcano" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="script">Script</Label>
              <Textarea id="script" name="script" required rows={7} placeholder="Write what the narrator says. Each sentence or two becomes a scene." />
              <p className="text-xs text-muted-foreground">To choose the footage, add search words in brackets after a line: Bees make honey. [bees honeycomb]</p>
              <p className="text-xs text-muted-foreground">Start lines with two names, like Maya: and Theo:, to make a two-host podcast. Add a big stat with [bees honeycomb | 18% | water left].</p>
            </div>
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          {route === "topic" ? (
            <div className="space-y-1.5">
              <Label htmlFor="duration">Length</Label>
              <select id="duration" name="duration" defaultValue={DURATIONS.includes(defaultDuration) ? defaultDuration : 30} className={fieldClass}>
                {DURATIONS.map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {seconds} seconds
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="tone">Tone</Label>
            <select id="tone" name="tone" defaultValue={defaultTone} className={fieldClass}>
              {TONES.map((tone) => (
                <option key={tone} value={tone}>
                  {tone[0].toUpperCase() + tone.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={pending || (route === "topic" && !aiAvailable)}>
          {pending ? "Starting…" : "Generate video"}
        </Button>
      </form>
    </Panel>
  );
}
