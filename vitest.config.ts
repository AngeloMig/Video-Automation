import { config } from "dotenv";
import { defineConfig } from "vitest/config";

config({ path: ".env.local" });

export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], testTimeout: 30_000, fileParallelism: false },
});
