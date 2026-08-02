/**
 * `build`: one walkthrough to one self-contained HTML file. Soft, like `open` —
 * a stale reference rides along as an error card and is printed, only a payload
 * that could not be built at all stops the command.
 */

import { fileURLToPath } from "node:url";
import { Effect, FileSystem, Path, Schema } from "effect";
import {
  discoverWalkthroughs,
  NO_WALKTHROUGH,
  NOT_A_REPO,
  type DiscoveryError,
} from "../check/discover.js";
import { softReport, type CheckOutcome } from "../check/run.js";
import { loadWalkthrough, type LoadError } from "../compile/load.js";
import { describeFailure } from "../failure.js";
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
  /** The walkthrough parsed but could not produce a payload. */
  | { kind: "failed"; outcome: CheckOutcome }
  /** Nothing to build, and the sentence that says why. */
  | { kind: "note"; message: string };

export class ExportBundleReadFailed extends Schema.TaggedErrorClass<ExportBundleReadFailed>()(
  "ExportBundleReadFailed",
  { dir: Schema.String, cause: Schema.Defect() },
) {}

export class ExportWriteFailed extends Schema.TaggedErrorClass<ExportWriteFailed>()(
  "ExportWriteFailed",
  { path: Schema.String, cause: Schema.Defect() },
) {}

export type BuildError = DiscoveryError | LoadError | ExportBundleReadFailed | ExportWriteFailed;

/** The export bundle ships beside the compiled CLI: `dist/cli.js` next to `dist/export/`. */
const BUNDLE_DIR = fileURLToPath(new URL("../export/", import.meta.url));

const EXPORT_BUNDLE_MISSING =
  `balade: no export bundle at ${BUNDLE_DIR}. In a checkout, run \`pnpm run build:app\`; ` +
  "in an install, reinstall balade.";

/** The two files the export vite mode emits, read as text. */
const readExportBundle = (dir: string = BUNDLE_DIR) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const read = (name: string) =>
      fs
        .readFileString(path.join(dir, name))
        .pipe(Effect.mapError((cause) => new ExportBundleReadFailed({ dir, cause })));
    return {
      js: yield* read("app.js"),
      css: yield* read("app.css"),
    } satisfies ExportAssets;
  });

export const runBuild = Effect.fn("runBuild")(function* (options: BuildOptions) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const target = yield* pick(options);
  if (typeof target !== "string") return target;

  const assets = yield* readExportBundle(options.bundleDir);

  const loaded = yield* loadWalkthrough({
    cwd: options.cwd,
    path: target,
    ...(options.lang !== undefined ? { lang: options.lang } : {}),
    ...(options.useGh !== undefined ? { useGh: options.useGh } : {}),
  });
  const report = softReport(loaded);
  const outcome: CheckOutcome = { ok: report.ok, reports: [report] };
  if (loaded.payload === null) return { kind: "failed", outcome } satisfies BuildOutcome;

  const file = outputPath(path, options, target);
  const html = exportHtml(loaded.payload, assets);
  yield* fs
    .writeFileString(file, html)
    .pipe(Effect.mapError((cause) => new ExportWriteFailed({ path: file, cause })));
  return { kind: "built", file, bytes: Buffer.byteLength(html), outcome } satisfies BuildOutcome;
});

/** Zero arguments list what discovery found (#21): the index is served-mode
    only, so `build` never picks for the author. */
const pick = Effect.fn("pickBuildTarget")(function* (options: BuildOptions) {
  const [first, second] = options.paths;
  if (second !== undefined) {
    return {
      kind: "note",
      message: `balade build exports one walkthrough at a time. Name one of the ${options.paths.length} you passed.`,
    } satisfies BuildOutcome;
  }
  if (first !== undefined) return first;

  const found = yield* discoverWalkthroughs(options.cwd).pipe(
    Effect.catchTag("NotARepository", () => Effect.void),
  );
  if (found === undefined) return { kind: "note", message: NOT_A_REPO } satisfies BuildOutcome;
  if (found.paths.length === 0)
    return { kind: "note", message: NO_WALKTHROUGH } satisfies BuildOutcome;
  return {
    kind: "note",
    message: [
      "balade build exports one walkthrough at a time. Name one of:",
      ...found.paths.map((path) => `  ${path}`),
    ].join("\n"),
  } satisfies BuildOutcome;
});

function outputPath(path: Path.Path, options: BuildOptions, target: string): string {
  if (options.out !== undefined) {
    return path.isAbsolute(options.out) ? options.out : path.resolve(options.cwd, options.out);
  }
  const absolute = path.isAbsolute(target) ? target : path.resolve(options.cwd, target);
  return path.join(
    path.dirname(absolute),
    `${path.basename(absolute, path.extname(absolute))}.html`,
  );
}

export function buildErrorMessage(error: BuildError): string {
  switch (error._tag) {
    case "ExportBundleReadFailed":
      return error.dir === BUNDLE_DIR
        ? EXPORT_BUNDLE_MISSING
        : `balade: no export bundle at ${error.dir}.`;
    case "ExportWriteFailed":
      return `balade: could not write ${error.path} (${describeFailure(error.cause)}).`;
    case "WalkthroughFileReadFailed":
      return `balade: could not read ${error.path} (${describeFailure(error.cause)}).`;
    case "NotARepository":
      return NOT_A_REPO;
    case "CommitUnresolvable":
      return `balade: the stamped commit ${error.commit} is not in this clone.`;
    case "PathResolutionFailed":
      return `balade: could not resolve ${error.path} (${describeFailure(error.cause)}).`;
    case "CommandFailed":
      return `balade: ${error.file} ${error.args.join(" ")} failed (exit ${error.code}).`;
    case "WalkthroughReadFailed":
      return `balade: could not read ${error.path} (${describeFailure(error.cause)}).`;
  }
}
