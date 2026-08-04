import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "app/src/**/*.test.{ts,tsx}"],
    exclude: ["test/paid/**/*.test.ts"],
    /* Each case builds a throwaway git repository and shells out to git. */
    testTimeout: 120_000,
    hookTimeout: 120_000,
    /* High-core hosts otherwise make the Git-heavy files contend past their hook timeout. */
    maxWorkers: 2,
  },
});
