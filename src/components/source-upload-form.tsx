"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { fieldClass, onFormSubmit, Panel } from "@/components/kit";
import { uploadFile } from "@/components/uploader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";

const RIGHTS = [
  ["i_created_it", "I created this video"],
  ["i_have_a_license", "I have a license or permission"],
  ["public_domain", "It's in the public domain"],
] as const;

export function SourceUploadForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [progress, setProgress] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  async function submit(form: FormData) {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return void toast.error("Choose a video to upload.");
    setProgress(0);
    try {
      const result = await uploadFile(
        file,
        {
          projectId,
          kind: "source_video",
          source: {
            projectId,
            title: String(form.get("title") || file.name.replace(/\.[^.]+$/, "")),
            rightsBasis: String(form.get("rights")),
            rightsConfirmed: confirmed,
          },
        },
        setProgress,
      );
      router.push(`/clipper/${result.sourceId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
      setProgress(null);
    }
  }

  const uploading = progress !== null;
  return (
    <Panel title="Upload a source video">
      <form onSubmit={onFormSubmit(submit)} className="space-y-4 p-4">
        <div className="space-y-1.5">
          <Label htmlFor="file">Video file</Label>
          <input id="file" name="file" type="file" required accept="video/mp4,video/quicktime,video/webm" className="block w-full text-sm text-muted-foreground file:mr-3 file:h-8 file:cursor-pointer file:rounded-md file:border-0 file:bg-secondary file:px-3 file:text-sm file:text-foreground" />
          <p className="text-xs text-muted-foreground">MP4, MOV or WebM, up to 5 GB.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="title">Title</Label>
          <Input id="title" name="title" placeholder="Uses the file name if blank" className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rights">Your rights to this footage</Label>
          <select id="rights" name="rights" className={fieldClass}>
            {RIGHTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 size-4 accent-[#58D5C9]" />
          <span className="text-muted-foreground">I confirm I have the rights to edit and publish this footage. A public YouTube video isn&apos;t automatically free to reuse.</span>
        </label>
        {uploading ? (
          <div className="space-y-1">
            <Progress value={progress * 100} />
            <p className="readout text-xs text-muted-foreground">{progress < 1 ? `Uploading ${Math.round(progress * 100)}%` : "Checking the file…"}</p>
          </div>
        ) : null}
        <Button type="submit" size="lg" className="w-full" disabled={uploading || !confirmed}>
          Upload video
        </Button>
      </form>
    </Panel>
  );
}
