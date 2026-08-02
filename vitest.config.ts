import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "app/src/**/*.test.{ts,tsx}"],
    /* Each case builds a throwaway git repository and shells out to git. */
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
