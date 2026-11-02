import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbLike = Db | Tx;

const holder = globalThis as unknown as { __videoDb?: Db; __videoClient?: postgres.Sql };

function connect(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. See .env.example.");
  // prepare: false keeps this compatible with Supabase's transaction pooler.
  holder.__videoClient = postgres(url, { prepare: false, max: Number(process.env.DATABASE_POOL_SIZE ?? 10) });
  return drizzle(holder.__videoClient, { schema });
}

/**
 * Owner connection that BYPASSES row-level security. Only the worker and bootstrap code may use
 * it, and every query must filter by workspace_id. Request code uses withUser instead.
 */
export function serviceDb(): Db {
  holder.__videoDb ??= connect();
  return holder.__videoDb;
}

/**
 * Ends a process that may have loaded Kokoro. process.exit crashes inside onnxruntime on macOS, so
 * this closes the database and lets Node exit by itself. The unref'd timer only fires if something
 * else is still holding the process open.
 */
export async function finishProcess(exitCode: number) {
  process.exitCode = exitCode;
  await holder.__videoClient?.end({ timeout: 5 });
  setTimeout(() => process.exit(exitCode), 5000).unref();
}

/** Runs fn in a transaction where RLS applies as this user, the same way Supabase does it. */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return serviceDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`);
    await tx.execute(sql`set local role authenticated`);
    return fn(tx);
  });
}
