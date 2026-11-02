import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { scopeCss } from "./viewer-css";

/** Both standalone and library builds must keep the same CSS and highlighter boundaries. */
export function viewerBoundaries(): Plugin[] {
  return [
    {
      name: "balade-diff-languages",
      enforce: "pre",
      resolveId(source, importer) {
        if (source === "lowlight" && importer?.includes("/@git-diff-view/lowlight/")) {
          return fileURLToPath(new URL("../app/src/highlight/diff-languages.ts", import.meta.url));
        }
      },
    },
    {
      name: "balade-scoped-styles",
      enforce: "pre",
      transform(code, id) {
        if (id.includes("/src/theme.css")) return { code: scopeCss(code), map: null };
      },
    },
  ];
}
