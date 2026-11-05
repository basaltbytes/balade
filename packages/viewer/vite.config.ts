import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { esmExternalRequirePlugin } from "rolldown/plugins";
import { defineConfig } from "vite";
import { viewerBoundaries } from "../../scripts/viewer-build";

/* Libraries a host may already ship stay external so its bundler resolves one
   copy; the curated Shiki grammars and Mermaid remain dynamic imports. The diff
   component stays bundled: its upstream highlighter imports every
   highlight.js grammar, which only this build's adapter removes. */
const external = [
  /^react(?:\/|$)/,
  /^react-dom(?:\/|$)/,
  /^effect(?:\/|$)/,
  /^shiki(?:\/|$)/,
  /^@shikijs\//,
  /^mermaid(?:\/|$)/,
  /^@primer\/octicons-react(?:\/|$)/,
];

export default defineConfig({
  root: fileURLToPath(new URL("../../app", import.meta.url)),
  plugins: [esmExternalRequirePlugin({ external }), react(), tailwindcss(), ...viewerBoundaries()],
  build: {
    outDir: fileURLToPath(new URL("dist", import.meta.url)),
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: "src/viewer-entry.ts",
      formats: ["es"],
      fileName: "index",
      cssFileName: "viewer",
    },
  },
});
