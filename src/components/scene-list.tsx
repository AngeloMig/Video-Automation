"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { formatDuration, StatusPill } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { regenerateSceneAction } from "@/server/actions";

type Scene = { id: string; position: number; narration: string; visualQuery: string | null; durationSeconds: number | null; hasFootage: boolean; hasVoice: boolean };

function SceneRow({ scene, busy }: { scene: Scene; busy: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [narration, setNarration] = useState(scene.narration);
  const [query, setQuery] = useState(scene.visualQuery ?? "");
  const [pending, start] = useTransition();

  const run = (input: { regenerateVoice?: boolean; regenerateVisual?: boolean; narration?: string; visualQuery?: string }, message: string) =>
    start(async () => {
      const result = await regenerateSceneAction({ sceneId: scene.id, ...input });
      if (!result.ok) return void toast.error(result.error);
      toast.success(message);
      setEditing(false);
      router.refresh();
    });

  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="readout mt-0.5 w-6 shrink-0 text-xs text-muted-foreground">{scene.position + 1}</span>
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-2">
              <Textarea aria-label={`Narration for scene ${scene.position + 1}`} rows={3} value={narration} onChange={(event) => setNarration(event.target.value)} />
              <Input aria-label="B-roll search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="B-roll search words" className="h-8" />
              <div className="flex gap-2">
                <Button size="sm" disabled={pending || busy} onClick={() => run({ narration, visualQuery: query || undefined, regenerateVisual: query !== (scene.visualQuery ?? "") }, "Scene is regenerating")}>
                  Save and regenerate
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm">{scene.narration}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="readout">{formatDuration(scene.durationSeconds)}</span>
                {scene.visualQuery ? <span>B-roll: {scene.visualQuery}</span> : null}
                {!scene.hasVoice ? <StatusPill>No voice yet</StatusPill> : null}
                {scene.hasVoice && !scene.hasFootage ? <StatusPill>Typographic card</StatusPill> : null}
              </p>
            </>
          )}
        </div>
        {editing ? null : (
          <div className="flex shrink-0 flex-wrap justify-end gap-1">
            <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button size="xs" variant="ghost" disabled={pending || busy} onClick={() => run({ regenerateVoice: true }, "Re-recording this scene")}>
              New voice
            </Button>
            <Button size="xs" variant="ghost" disabled={pending || busy} onClick={() => run({ regenerateVisual: true }, "Finding new footage")}>
              New B-roll
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

export function SceneList({ scenes, busy, estimatedCaptions }: { scenes: Scene[]; busy: boolean; estimatedCaptions: boolean }) {
  return (
    <>
      <ol className="divide-y divide-border">
        {scenes.map((scene) => (
          <SceneRow key={scene.id} scene={scene} busy={busy} />
        ))}
      </ol>
      {estimatedCaptions ? <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Caption timing is estimated because this voice provider doesn&apos;t report word timings. ElevenLabs gives exact timing.</p> : null}
    </>
  );
}
