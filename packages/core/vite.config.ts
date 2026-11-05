import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/* Effect is a peer and Markdoc and YAML are dependencies, so a host resolves one copy of each. */
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: fileURLToPath(new URL("../../src/core.ts", import.meta.url)),
      formats: ["es"],
      fileName: "index",
    },
    rolldownOptions: {
      external: [/^effect(?:\/|$)/, /^@markdoc\/markdoc(?:\/|$)/, /^yaml(?:\/|$)/],
    },
  },
});
