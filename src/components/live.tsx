"use client";

import { RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/server/context";

/** Re-reads server data while jobs are active. It stops when nothing is running. */
export function LiveRefresh({ active, intervalMs = 3000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs, router]);
  return null;
}

type ActionButtonProps = Omit<React.ComponentProps<typeof Button>, "onClick"> & {
  action: () => Promise<ActionResult<unknown>>;
  success?: string;
  confirm?: string;
  onDone?: () => void;
};

/** Reports success only after the server confirms it, and shows the real error when it doesn't. */
export function ActionButton({ action, success, confirm, onDone, children, disabled, ...props }: ActionButtonProps) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      {...props}
      disabled={disabled || pending}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => {
          const result = await action();
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          if (success) toast.success(success);
          onDone?.();
          router.refresh();
        });
      }}
    >
      {pending ? <RotateCw className="size-3.5 animate-spin" aria-hidden /> : null}
      {children}
    </Button>
  );
}
