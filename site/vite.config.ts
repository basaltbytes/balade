import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The landing page: one static screen, deployed to Cloudflare as an
 * assets-only Worker. The Cloudflare plugin reads `wrangler.jsonc` beside this
 * file and fills in the assets directory from the build output, so
 * `wrangler deploy` works right after `vite build site`.
 */
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), cloudflare()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
