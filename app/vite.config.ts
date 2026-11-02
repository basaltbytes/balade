import tailwindcss from "@tailwindcss/vite";
import { viewerBoundaries } from "../scripts/viewer-build";
import react from "@vitejs/plugin-react";
import { defineConfig, type BuildEnvironmentOptions } from "vite";

/**
 * Two builds of the same app.
 *
 * The default build is what `open` serves: code-split, so a shiki grammar is
 * fetched only when a payload names it. `--mode export` builds what `build`
 * inlines into one HTML file — a single JS and a single CSS, since a `file://`
 * page has nowhere to fetch a chunk from. Every grammar rides along there.
 */
export default defineConfig(({ mode }) => {
  const single = mode === "export";
  const singleFileFacets: Pick<
    BuildEnvironmentOptions,
    "cssCodeSplit" | "assetsInlineLimit" | "rollupOptions"
  > = {};
  if (single) {
    singleFileFacets.cssCodeSplit = false;
    /* Anything an import pulls in becomes a `data:` URI: the export names no
       file but itself. */
    singleFileFacets.assetsInlineLimit = Number.MAX_SAFE_INTEGER;
    singleFileFacets.rollupOptions = {
      output: {
        /* The bundler's name for `inlineDynamicImports`, which it deprecated:
           one chunk, every grammar in it. */
        codeSplitting: false,
        /* `build` reads these two by name. */
        entryFileNames: "app.js",
        assetFileNames: "app[extname]",
      },
    };
  }
  return {
    /* `base: "./"` keeps the asset URLs relative so the same bundle works served
       from `/` and inlined into the single-file static export. */
    base: "./",
    plugins: [react(), tailwindcss(), ...viewerBoundaries()],
    build: {
      /* The tarball ships `dist/` only, and the CLI finds the bundles beside
         itself: `dist/cli.js` next to `dist/app/` and `dist/export/`. Emptying
         stops at that directory, so the compiled CLI survives an app rebuild. */
      outDir: single ? "../dist/export" : "../dist/app",
      emptyOutDir: true,
      /* The single-file export includes Mermaid and every supported Shiki grammar. */
      chunkSizeWarningLimit: single ? 5000 : 1700,
      ...singleFileFacets,
    },
  };
});
