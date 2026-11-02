import "dotenv/config";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import EmbeddedPostgres from "embedded-postgres";

/** Runs a real local Postgres with no Docker. Data lives in .data/postgres. */
const dir = process.env.LOCAL_PG_DIR ?? ".data/postgres";
const port = Number(process.env.LOCAL_PG_PORT ?? 54329);

async function main() {
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port, persistent: true });
  if (!existsSync(`${dir}/PG_VERSION`)) await pg.initialise();
  await pg.start();
  try {
    await pg.createDatabase("video_automation");
  } catch {
    // Already exists.
  }
  // Safe to run every time: applied migrations are skipped.
  execFileSync("pnpm", ["-s", "db:migrate:local"], { stdio: "inherit" });
  console.log(`postgres ready on postgres://postgres:postgres@localhost:${port}/video_automation`);
  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
