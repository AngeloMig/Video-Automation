import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { createServerClient } from "@supabase/ssr";
import { sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { serviceDb } from "@/db/client";

/**
 * Supabase Auth in production. Without Supabase configured, a development sign-in stored in the
 * local Postgres auth shim lets the full app run on one machine. It refuses to run in production.
 */
export type Session = { userId: string; email: string };

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const LOCAL_COOKIE = "relay_session";
const LOCAL_SESSION_SECONDS = 60 * 60 * 24 * 14;

export function authMode(): "supabase" | "local" {
  return process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "supabase" : "local";
}

function localSecret() {
  if (process.env.NODE_ENV === "production") throw new Error("Development sign-in is disabled in production. Configure Supabase.");
  const secret = process.env.LOCAL_AUTH_SECRET;
  if (!secret) throw new Error("LOCAL_AUTH_SECRET is not set. See .env.example.");
  return secret;
}

function sign(payload: string) {
  return createHmac("sha256", localSecret()).update(payload).digest("base64url");
}

async function setLocalSession(userId: string) {
  const expires = Math.floor(Date.now() / 1000) + LOCAL_SESSION_SECONDS;
  const payload = `${userId}.${expires}`;
  (await cookies()).set(LOCAL_COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: LOCAL_SESSION_SECONDS,
  });
}

async function supabaseServer() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => {
        try {
          for (const { name, value, options } of values) store.set(name, value, options);
        } catch {
          // Server components can't write cookies. The proxy refreshes the session instead.
        }
      },
    },
  });
}

export async function getSession(): Promise<Session | null> {
  if (authMode() === "supabase") {
    // getUser verifies the token with Supabase, unlike getSession, which only reads the cookie.
    const { data } = await (await supabaseServer()).auth.getUser();
    return data.user ? { userId: data.user.id, email: data.user.email ?? "" } : null;
  }
  const value = (await cookies()).get(LOCAL_COOKIE)?.value;
  if (!value) return null;
  const [userId, expires, signature] = value.split(".");
  if (!userId || !expires || !signature) return null;
  const expected = Buffer.from(sign(`${userId}.${expires}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (Number(expires) < Date.now() / 1000) return null;
  const rows = await serviceDb().execute(sql`select email from auth.users where id = ${userId}`);
  const row = rows[0] as { email: string } | undefined;
  return row ? { userId, email: row.email } : null;
}

export async function signUp(email: string, password: string): Promise<{ error?: string; needsConfirmation?: boolean }> {
  if (authMode() === "supabase") {
    const { data, error } = await (await supabaseServer()).auth.signUp({ email, password });
    if (error) return { error: error.message };
    return { needsConfirmation: !data.session };
  }
  localSecret();
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  const stored = `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
  try {
    const rows = await serviceDb().execute(sql`insert into auth.users (email, encrypted_password) values (${email}, ${stored}) returning id`);
    await setLocalSession((rows[0] as { id: string }).id);
    return {};
  } catch {
    return { error: "An account with this email already exists." };
  }
}

export async function signIn(email: string, password: string): Promise<{ error?: string }> {
  if (authMode() === "supabase") {
    const { error } = await (await supabaseServer()).auth.signInWithPassword({ email, password });
    return error ? { error: "Email or password is incorrect." } : {};
  }
  localSecret();
  const rows = await serviceDb().execute(sql`select id, encrypted_password from auth.users where email = ${email}`);
  const row = rows[0] as { id: string; encrypted_password: string | null } | undefined;
  const [, salt, hash] = row?.encrypted_password?.split("$") ?? [];
  if (!row || !salt || !hash) return { error: "Email or password is incorrect." };
  const attempt = await scrypt(password, Buffer.from(salt, "base64"), 64);
  if (!timingSafeEqual(attempt, Buffer.from(hash, "base64"))) return { error: "Email or password is incorrect." };
  await setLocalSession(row.id);
  return {};
}

export async function signOut() {
  if (authMode() === "supabase") await (await supabaseServer()).auth.signOut();
  else (await cookies()).delete(LOCAL_COOKIE);
}
