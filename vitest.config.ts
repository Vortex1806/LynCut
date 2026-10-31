import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Integration tests share one Postgres and one Redis; running files in
    // parallel would have them truncating each other's rows mid-test.
    fileParallelism: false,
    setupFiles: ["tests/setup-env.ts"],
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
