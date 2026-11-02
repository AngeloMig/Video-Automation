"use client";

import { Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export type UploadResult = { id: string; sourceId: string | null; durationSeconds: number | null };

async function readError(response: Response) {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? "Upload failed.";
}

/** Upload with real progress: ask for a target, send the bytes, then have the server validate them. */
export async function uploadFile(
  file: File,
  options: { projectId: string | null; kind: string; source?: { projectId: string; title: string; rightsBasis: string; rightsConfirmed: boolean } },
  onProgress: (fraction: number) => void,
): Promise<UploadResult> {
  const init = await fetch("/api/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: options.projectId, kind: options.kind, filename: file.name, contentType: file.type, sizeBytes: file.size }),
  });
  if (!init.ok) throw new Error(await readError(init));
  const { id, target } = (await init.json()) as { id: string; target: { url: string; method: string; headers: Record<string, string> } };

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(target.method, target.url);
    for (const [name, value] of Object.entries(target.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error("The upload was rejected.")));
    xhr.onerror = () => reject(new Error("The connection dropped during the upload."));
    xhr.send(file);
  });

  const complete = await fetch(`/api/uploads/${id}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: options.source }),
  });
  if (!complete.ok) throw new Error(await readError(complete));
  return complete.json();
}

/** A one-button upload for B-roll, logos and music. Source videos use the clipper's own form. */
export function AssetUploadButton({
  projectId,
  kind,
  accept,
  label,
  onUploaded,
}: {
  projectId: string | null;
  kind: string;
  accept: string;
  label: string;
  onUploaded: (result: UploadResult) => void | Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  return (
    <div className="space-y-1.5">
      <input
        ref={input}
        type="file"
        accept={accept}
        aria-label={label}
        className="sr-only"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setProgress(0);
          try {
            await onUploaded(await uploadFile(file, { projectId, kind }, setProgress));
            toast.success(`Uploaded ${file.name}`);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Upload failed.");
          } finally {
            setProgress(null);
          }
        }}
      />
      <Button type="button" variant="outline" size="sm" disabled={progress !== null} onClick={() => input.current?.click()}>
        <Upload className="size-3.5" aria-hidden />
        {progress !== null ? `Uploading ${Math.round(progress * 100)}%` : label}
      </Button>
      {progress !== null ? <Progress value={progress * 100} /> : null}
    </div>
  );
}
