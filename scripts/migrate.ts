import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

/** Applies supabase/migrations in order. With --local it first applies the Supabase shim. */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. See .env.example.");
  const sql = postgres(url, { max: 1, onnotice: () => {} });

  if (process.argv.includes("--local")) await sql.unsafe(readFileSync("db/local-shim.sql", "utf8"));

  await sql`create table if not exists public.app_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const applied = new Set((await sql<{ name: string }[]>`select name from public.app_migrations`).map((r) => r.name));

  const dir = "supabase/migrations";
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (applied.has(name)) continue;
    const body = readFileSync(join(dir, name), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into public.app_migrations (name) values (${name})`;
    });
    console.log(`applied ${name}`);
  }
  await sql.end();
  console.log("migrations up to date");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
