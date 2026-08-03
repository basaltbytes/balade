import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/paid/**/*.test.ts"],
    testTimeout: 900_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
