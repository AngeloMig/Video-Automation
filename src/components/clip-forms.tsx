"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Panel, onFormSubmit } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createManualClipAction, startClipAnalysisAction } from "@/server/actions";

export function ClipAnalysisForm({ sourceAssetId, transcribed, busy }: { sourceAssetId: string; transcribed: boolean; busy: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Panel title="Find highlights" description={transcribed ? "Uses the saved transcript, so it isn't charged again." : "Transcribes the video, then picks self-contained moments."}>
      <form
        className="grid grid-cols-3 gap-3 p-4"
        onSubmit={onFormSubmit((form) =>
          start(async () => {
            const result = await startClipAnalysisAction({
              sourceAssetId,
              minSeconds: Number(form.get("min")),
              maxSeconds: Number(form.get("max")),
              clipCount: Number(form.get("count")),
            });
            if (!result.ok) return void toast.error(result.error);
            router.refresh();
          }),
        )}
      >
        <div className="space-y-1.5">
          <Label htmlFor="min">Shortest (s)</Label>
          <Input id="min" name="min" type="number" min={5} max={170} defaultValue={20} className="readout h-9" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="max">Longest (s)</Label>
          <Input id="max" name="max" type="number" min={10} max={180} defaultValue={60} className="readout h-9" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="count">Clips</Label>
          <Input id="count" name="count" type="number" min={1} max={10} defaultValue={5} className="readout h-9" />
        </div>
        <Button type="submit" className="col-span-3 h-9" disabled={pending || busy}>
          {busy ? "Working…" : "Find highlights"}
        </Button>
      </form>
    </Panel>
  );
}

export function ManualClipForm({ sourceAssetId, durationSeconds, hasTranscript }: { sourceAssetId: string; durationSeconds: number; hasTranscript: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Panel title="Cut a clip by timecode" description={hasTranscript ? "Captions come from the transcript." : "Without a transcript, this clip won't have captions."}>
      <form
        className="grid grid-cols-2 gap-3 p-4"
        onSubmit={onFormSubmit((form) =>
          start(async () => {
            const result = await createManualClipAction({
              sourceAssetId,
              title: String(form.get("title")),
              startSeconds: Number(form.get("start")),
              endSeconds: Number(form.get("end")),
              focusX: Number(form.get("focus")) / 100,
            });
            if (!result.ok) return void toast.error(result.error);
            toast.success("Clip created");
            router.refresh();
          }),
        )}
      >
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="clip-title">Title</Label>
          <Input id="clip-title" name="title" required className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="start">Start (seconds)</Label>
          <Input id="start" name="start" type="number" step="0.1" min={0} max={durationSeconds} defaultValue={0} required className="readout h-9" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="end">End (seconds)</Label>
          <Input id="end" name="end" type="number" step="0.1" min={0.1} max={durationSeconds} defaultValue={Math.min(30, Math.floor(durationSeconds))} required className="readout h-9" />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="focus">Crop focus: left to right</Label>
          <input id="focus" name="focus" type="range" min={0} max={100} defaultValue={50} className="w-full accent-[#58D5C9]" />
          <p className="text-xs text-muted-foreground">Sets where the 9:16 crop sits. Automatic subject tracking arrives in Phase 3.</p>
        </div>
        <Button type="submit" variant="outline" className="col-span-2 h-9" disabled={pending}>
          Create clip
        </Button>
      </form>
    </Panel>
  );
}
