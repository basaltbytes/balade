/**
 * `build`: one walkthrough to one self-contained HTML file. Soft, like `open` —
 * a stale reference rides along as an error card and is printed, only a payload
 * that could not be built at all stops the command.
 */

import { fileURLToPath } from "node:url";
import { Effect, FileSystem, Match, Path, Predicate, Schema } from "effect";
import {
  discoverWalkthroughs,
  NO_WALKTHROUGH,
  NOT_A_REPO,
  type DiscoveryError,
} from "../../walkthrough/discovery.js";
import { softReport } from "../../walkthrough/checker.js";
import { loadWalkthrough, type LoadError, type LoadOptions } from "../../walkthrough/pipeline.js";
import { describeFailure } from "../../failure.js";
import type { Lang, CheckReport } from "../../contract/types.js";
import { exportHtml, type ExportAssets } from "./html.js";

export interface BuildOptions {
  cwd: string;
  /** The command line's file arguments; exactly one builds. */
  paths: readonly string[];
  /** Output path, absolute or relative to `cwd`. Defaults to `<walkthrough>.html`. */
  out?: string;
  /** Chrome language override (`--lang`). */
  lang?: Lang;
  /** `false` skips gh entirely. */
  useGh?: boolean;
  /** Where the export bundle is read from; defaults to the one shipped beside the CLI. */
  bundleDir?: string;
}

/** Written; `reports` may still carry warnings and renderable error cards. */
export interface Built {
  readonly _tag: "Built";
  readonly file: string;
  readonly bytes: number;
  readonly changedFileCount: number;
  readonly reports: readonly CheckReport[];
}

/** The walkthrough parsed but could not produce a payload. */
export interface BuildFailed {
  readonly _tag: "BuildFailed";
  readonly reports: readonly CheckReport[];
}

/** Nothing to build, and the sentence that says why. */
export interface BuildNotRun {
  readonly _tag: "BuildNotRun";
  readonly message: string;
}

export type BuildOutcome = Built | BuildFailed | BuildNotRun;

export class ExportBundleReadFailed extends Schema.TaggedErrorClass<ExportBundleReadFailed>()(
  "ExportBundleReadFailed",
  { dir: Schema.String, file: Schema.String, cause: Schema.Defect() },
) {}

export class ExportWriteFailed extends Schema.TaggedErrorClass<ExportWriteFailed>()(
  "ExportWriteFailed",
  { path: Schema.String, cause: Schema.Defect() },
) {}

export type BuildError = DiscoveryError | LoadError | ExportBundleReadFailed | ExportWriteFailed;

/** The export bundle ships beside the compiled CLI: `dist/cli.js` next to `dist/export/`. */
const BUNDLE_DIR = fileURLToPath(new URL("../../export/", import.meta.url));

const EXPORT_BUNDLE_REPAIR =
  " In a checkout, run `pnpm run build:app`; in an install, reinstall balade.";

/** The two files the export vite mode emits, read as text. */
const readExportBundle = Effect.fn("readExportBundle")(function* (dir: string = BUNDLE_DIR) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const read = (name: string) => {
    const file = path.join(dir, name);
    return fs
      .readFileString(file)
      .pipe(Effect.mapError((cause) => new ExportBundleReadFailed({ dir, file, cause })));
  };
  return {
    js: yield* read("app.js"),
    css: yield* read("app.css"),
  } satisfies ExportAssets;
});

export const runBuild = Effect.fn("runBuild")(function* (options: BuildOptions) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const target = yield* pick(options);
  if (!Predicate.isString(target)) return target;

  const assets = yield* readExportBundle(options.bundleDir);

  const loadOptions: LoadOptions = { cwd: options.cwd, path: target };
  if (options.lang !== undefined) loadOptions.lang = options.lang;
  if (options.useGh !== undefined) loadOptions.useGh = options.useGh;
  const loaded = yield* loadWalkthrough(loadOptions);
  const report = softReport(loaded);
  if (loaded.payload === null) {
    return { _tag: "BuildFailed", reports: [report] } satisfies BuildFailed;
  }

  const file = outputPath(path, options, target);
  const html = exportHtml(loaded.payload, assets);
  yield* fs
    .writeFileString(file, html)
    .pipe(Effect.mapError((cause) => new ExportWriteFailed({ path: file, cause })));
  return {
    _tag: "Built",
    file,
    bytes: Buffer.byteLength(html),
    changedFileCount: loaded.payload.files.length,
    reports: [report],
  } satisfies Built;
});

export function exportContentsMessage(changedFileCount: number): string {
  return (
    `contains the full contents of all ${changedFileCount} changed ` +
    `${changedFileCount === 1 ? "file" : "files"} at both revisions`
  );
}

/** Zero arguments list what discovery found (#21): the index is served-mode
    only, so `build` never picks for the author. */
const pick = Effect.fn("pickBuildTarget")(function* (options: BuildOptions) {
  const [first, second] = options.paths;
  if (second !== undefined) {
    return {
      _tag: "BuildNotRun",
      message: `balade build exports one walkthrough at a time. Name one of the ${options.paths.length} you passed.`,
    } satisfies BuildOutcome;
  }
  if (first !== undefined) return first;

  const found = yield* discoverWalkthroughs(options.cwd).pipe(
    Effect.catchTag("NotARepository", () => Effect.void),
  );
  if (found === undefined)
    return { _tag: "BuildNotRun", message: NOT_A_REPO } satisfies BuildOutcome;
  if (found.paths.length === 0)
    return { _tag: "BuildNotRun", message: NO_WALKTHROUGH } satisfies BuildOutcome;
  return {
    _tag: "BuildNotRun",
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
  return Match.valueTags(error, {
    ExportBundleReadFailed: ({ dir, file, cause }) =>
      `balade: could not read export bundle ${file} (${describeFailure(cause)}).` +
      (dir === BUNDLE_DIR ? EXPORT_BUNDLE_REPAIR : ""),
    ExportWriteFailed: ({ path, cause }) =>
      `balade: could not write ${path} (${describeFailure(cause)}).`,
    WalkthroughFileReadFailed: ({ path, cause }) =>
      `balade: could not read ${path} (${describeFailure(cause)}).`,
    NotARepository: () => NOT_A_REPO,
    CommitUnresolvable: ({ commit }) =>
      `balade: the stamped commit ${commit} is not in this clone.`,
    PathResolutionFailed: ({ path, cause }) =>
      `balade: could not resolve ${path} (${describeFailure(cause)}).`,
    CommandFailed: ({ file, args, code }) =>
      `balade: ${file} ${args.join(" ")} failed (exit ${code}).`,
    WalkthroughReadFailed: ({ path, cause }) =>
      `balade: could not read ${path} (${describeFailure(cause)}).`,
  });
}
