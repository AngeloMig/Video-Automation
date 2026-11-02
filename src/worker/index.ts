import { hostname } from "node:os";
import { finishProcess } from "../db/client";
import { recordWorkerHeartbeat, removeWorkerHeartbeat, workLoop } from "./runner";

const workerId = `${hostname()}:${process.pid}`;
const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 1);
let stopping = false;

/** Waits for the database, so startup order doesn't matter locally or on a deploy. */
async function waitForDatabase() {
  for (let attempt = 1; ; attempt++) {
    try {
      await recordWorkerHeartbeat(workerId);
      return;
    } catch (error) {
      if (attempt >= 60 || stopping) throw error;
      if (attempt === 1) console.log("waiting for the database and migrations");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function main() {
  await waitForDatabase();
  console.log(`worker ${workerId} started, concurrency ${concurrency}`);
  const beat = setInterval(() => void recordWorkerHeartbeat(workerId).catch(console.error), 10_000);

  // Each slot gets its own id, because the lease owner identifies which loop holds a job.
  await Promise.all(
    Array.from({ length: concurrency }, (_, slot) =>
      workLoop({ workerId: `${workerId}#${slot}`, shouldStop: () => stopping }),
    ),
  );

  clearInterval(beat);
  await removeWorkerHeartbeat(workerId);
  console.log("worker stopped");
  await finishProcess(0);
}

// Finishes the current job, then exits. An unfinished job is reclaimed when its lease expires.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`${signal} received, finishing the current job`);
    stopping = true;
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
