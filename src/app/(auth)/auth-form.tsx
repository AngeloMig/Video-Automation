"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RelayMark } from "@/components/relay-mark";
import { loginAction, signupAction } from "@/server/actions";

type State = { error?: string; notice?: string } | null;

export function AuthForm({ mode, localAuth }: { mode: "login" | "signup"; localAuth: boolean }) {
  const [state, action, pending] = useActionState<State, FormData>(mode === "login" ? loginAction : signupAction, null);
  const isLogin = mode === "login";
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <RelayMark className="mb-8" />
        <h1 className="text-2xl font-semibold tracking-tight">{isLogin ? "Sign in" : "Create your studio"}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {isLogin ? "Pick up where your agents left off." : "Includes one workspace on the Starter plan."}
        </p>
        <form action={action} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete={isLogin ? "current-password" : "new-password"} required minLength={isLogin ? undefined : 8} className="h-10" />
            {!isLogin ? <p className="text-xs text-muted-foreground">At least 8 characters.</p> : null}
          </div>
          {state?.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
          {state?.notice ? <p role="status" className="text-sm text-primary">{state.notice}</p> : null}
          <Button type="submit" size="lg" className="h-10 w-full" disabled={pending}>
            {pending ? "One moment…" : isLogin ? "Sign in" : "Create account"}
          </Button>
        </form>
        <p className="mt-6 text-sm text-muted-foreground">
          {isLogin ? "New here? " : "Already have an account? "}
          <Link href={isLogin ? "/signup" : "/login"} className="text-primary underline-offset-4 hover:underline">
            {isLogin ? "Create an account" : "Sign in"}
          </Link>
        </p>
        {localAuth ? (
          <p className="mt-8 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
            Development sign-in: accounts are stored in your local database. Add Supabase keys for production.
          </p>
        ) : null}
      </div>
    </main>
  );
}
