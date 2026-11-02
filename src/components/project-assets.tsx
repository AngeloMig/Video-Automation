"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { fieldClass, Panel } from "@/components/kit";
import { AssetUploadButton } from "@/components/uploader";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { listVoicesAction, setProjectAssetAction, setVoiceAction } from "@/server/actions";

type Option = { id: string; name: string };

export function ProjectAssets({
  projectId,
  logoAssetId,
  musicAssetId,
  voiceId,
  voiceSpeed,
  logos,
  music,
}: {
  projectId: string;
  logoAssetId: string | null;
  musicAssetId: string | null;
  voiceId: string | null;
  voiceSpeed: number;
  logos: Option[];
  music: Option[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [voices, setVoices] = useState<{ id: string; label: string }[] | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voice, setVoice] = useState(voiceId ?? "");
  const [speed, setSpeed] = useState(voiceSpeed);

  useEffect(() => {
    listVoicesAction().then((result) => {
      if (result.ok) setVoices(result.voices);
      else setVoiceError(result.error);
    });
  }, []);

  const setAsset = (field: "logoAssetId" | "musicAssetId", assetId: string | null) =>
    start(async () => {
      const result = await setProjectAssetAction(projectId, field, assetId);
      if (!result.ok) toast.error(result.error);
      router.refresh();
    });

  const row = (field: "logoAssetId" | "musicAssetId", label: string, options: Option[], current: string | null, kind: string, accept: string, uploadLabel: string, note: string) => (
    <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-end">
      <div className="space-y-1.5">
        <Label htmlFor={field}>{label}</Label>
        <select id={field} className={fieldClass} value={current ?? ""} disabled={pending} onChange={(event) => setAsset(field, event.target.value || null)}>
          <option value="">None</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">{note}</p>
      </div>
      <AssetUploadButton projectId={projectId} kind={kind} accept={accept} label={uploadLabel} onUploaded={(result) => setAsset(field, result.id)} />
    </div>
  );

  return (
    <Panel title="Brand assets and voice" description="New videos use these. Existing timelines keep what they were built with.">
      <div className="space-y-5 p-4">
        {row("logoAssetId", "Logo or watermark", logos, logoAssetId, "logo", "image/png,image/jpeg,image/webp", "Upload logo", "Shown in the top corner of each video.")}
        {row("musicAssetId", "Background music", music, musicAssetId, "music", "audio/mpeg,audio/mp4,audio/wav", "Upload track", "Only upload music you have a license to use.")}
        <div className="grid gap-3 md:grid-cols-[1fr_160px_auto] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="voice">Voice</Label>
            <select id="voice" className={fieldClass} value={voice} disabled={!voices} onChange={(event) => setVoice(event.target.value)}>
              <option value="">Provider default</option>
              {voices?.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            {voiceError ? <p className="text-xs text-destructive">{voiceError}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="speed">Speaking speed</Label>
            <input id="speed" type="number" step={0.05} min={0.5} max={2} value={speed} onChange={(event) => setSpeed(Number(event.target.value))} className={fieldClass} />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await setVoiceAction(projectId, voice || null, speed);
                if (result.ok) toast.success("Voice saved");
                else toast.error(result.error);
              })
            }
          >
            Save voice
          </Button>
        </div>
      </div>
    </Panel>
  );
}
