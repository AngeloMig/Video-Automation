"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { onFormSubmit } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { renameWorkspaceAction } from "@/server/actions";

export function WorkspaceNameForm({ name }: { name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-wrap items-end gap-2 p-4"
      onSubmit={onFormSubmit((form) =>
        start(async () => {
          const result = await renameWorkspaceAction(String(form.get("name")));
          if (!result.ok) return void toast.error(result.error);
          toast.success("Workspace renamed");
          router.refresh();
        }),
      )}
    >
      <div className="min-w-[220px] flex-1 space-y-1.5">
        <Label htmlFor="workspace">Workspace name</Label>
        <Input id="workspace" name="name" defaultValue={name} required className="h-9" />
      </div>
      <Button type="submit" variant="outline" className="h-9" disabled={pending}>Save</Button>
    </form>
  );
}
