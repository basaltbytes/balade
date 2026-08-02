/**
 * `build`: one walkthrough to one self-contained HTML file. Soft, like `open` —
 * a stale reference rides along as an error card and is printed, only a payload
 * that could not be built at all stops the command.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverWalkthroughs, NO_WALKTHROUGH, NOT_A_REPO } from "../check/discover.js";
import { softReport, type CheckOutcome } from "../check/run.js";
import { loadWalkthrough } from "../compile/load.js";
import { exportHtml, type ExportAssets } from "./html.js";

export interface BuildOptions {
  cwd: string;
  /** The command line's file arguments; exactly one builds. */
  paths: readonly string[];
  /** Output path, absolute or relative to `cwd`. Defaults to `<walkthrough>.html`. */
  out?: string;
  /** Chrome language override (`--lang`). */
  lang?: "en" | "fr";
  /** `false` skips gh entirely. */
  useGh?: boolean;
  /** Where the export bundle is read from; defaults to the one shipped beside the CLI. */
  bundleDir?: string;
}

export type BuildOutcome =
  /** Written; `outcome` may still carry warnings and error cards. */
  | { kind: "built"; file: string; bytes: number; outcome: CheckOutcome }
  /** A dead repository, PR or file: `build` prints this and stops. */
  | { kind: "failed"; outcome: CheckOutcome }
  /** Nothing to build, and the sentence that says why. */
  | { kind: "note"; message: string };

/** The export bundle ships beside the compiled CLI: `dist/cli.js` next to `dist/export/`. */
const BUNDLE_DIR = fileURLToPath(new URL("../export/", import.meta.url));

const EXPORT_BUNDLE_MISSING =
  `balade: no export bundle at ${BUNDLE_DIR}. In a checkout, run \`pnpm run build:app\`; ` +
  "in an install, reinstall balade.";

/** The two files the export vite mode emits, read as text. */
function readExportBundle(dir: string = BUNDLE_DIR): ExportAssets | null {
  try {
    return {
      js: readFileSync(join(dir, "app.js"), "utf8"),
      css: readFileSync(join(dir, "app.css"), "utf8"),
    };
  } catch {
    return null;
  }
}

export function runBuild(options: BuildOptions): BuildOutcome {
  const target = pick(options);
  if (typeof target !== "string") return target;

  const assets = readExportBundle(options.bundleDir);
  if (assets === null) return { kind: "note", message: EXPORT_BUNDLE_MISSING };

  const loaded = loadWalkthrough({
    cwd: options.cwd,
    path: target,
    ...(options.lang !== undefined ? { lang: options.lang } : {}),
    ...(options.useGh !== undefined ? { useGh: options.useGh } : {}),
  });
  const report = softReport(loaded);
  const outcome: CheckOutcome = { ok: report.ok, reports: [report] };
  if (loaded.payload === null) return { kind: "failed", outcome };

  const file = outputPath(options, target);
  const html = exportHtml(loaded.payload, assets);
  try {
    writeFileSync(file, html, "utf8");
  } catch (error) {
    return {
      kind: "note",
      message: `balade: could not write ${file} (${error instanceof Error ? error.message : String(error)}).`,
    };
  }
  return { kind: "built", file, bytes: Buffer.byteLength(html), outcome };
}

/** Zero arguments list what discovery found (#21): the index is served-mode
    only, so `build` never picks for the author. */
function pick(options: BuildOptions): string | { kind: "note"; message: string } {
  const [first, second] = options.paths;
  if (second !== undefined) {
    return {
      kind: "note",
      message: `balade build exports one walkthrough at a time. Name one of the ${options.paths.length} you passed.`,
    };
  }
  if (first !== undefined) return first;

  const found = discoverWalkthroughs(options.cwd);
  if (found.repoRoot === null) return { kind: "note", message: NOT_A_REPO };
  if (found.paths.length === 0) return { kind: "note", message: NO_WALKTHROUGH };
  return {
    kind: "note",
    message: [
      "balade build exports one walkthrough at a time. Name one of:",
      ...found.paths.map((path) => `  ${path}`),
    ].join("\n"),
  };
}

function outputPath(options: BuildOptions, target: string): string {
  if (options.out !== undefined) {
    return isAbsolute(options.out) ? options.out : resolvePath(options.cwd, options.out);
  }
  const absolute = isAbsolute(target) ? target : resolvePath(options.cwd, target);
  return join(dirname(absolute), `${basename(absolute, extname(absolute))}.html`);
}
