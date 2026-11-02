import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { esmExternalRequirePlugin } from "rolldown/plugins";
import { defineConfig } from "vite";
import { viewerBoundaries } from "../scripts/viewer-build";

export default defineConfig({
  plugins: [
    esmExternalRequirePlugin({ external: [/^react(?:\/|$)/, /^react-dom(?:\/|$)/] }),
    react(),
    tailwindcss(),
    ...viewerBoundaries(),
  ],
  build: {
    outDir: "../dist/viewer",
    emptyOutDir: true,
    lib: {
      entry: "src/viewer-entry.ts",
      formats: ["es"],
      fileName: "index",
      cssFileName: "viewer",
    },
  },
});
