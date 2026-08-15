/**
 * `check`: one pass over every walkthrough, every diagnostic with a
 * code, `file:line` where known, and a fix hint, plus the boundary echo of
 * every resolved code range.
 */

import { Effect, Path, Result } from "effect";
import {
  loadErrorDiagnostic,
  loadWalkthrough,
  type LoadOptions,
  type LoadResult,
} from "./pipeline.js";
import type { CheckReport } from "../contract/types.js";
import type { PullResolution } from "../contract/context.js";
import { discoveryErrorMessage, discoverWalkthroughs, NO_WALKTHROUGH } from "./discovery.js";

export interface CheckFileOptions {
  cwd: string;
  /** Path of the walkthrough file, absolute or relative to `cwd`. */
  path: string;
  /** Prepared pull resolution whose Git objects should be rehydrated without re-resolution. */
  resolution?: PullResolution;
  /** `false` skips gh entirely — CI without auth, and the test fixtures. */
  useGh?: boolean;
}

export interface CheckOptions {
  cwd: string;
  /** Explicit files; empty means discover every walkthrough in the repository. */
  paths?: readonly string[];
  /** `false` skips gh entirely — CI without auth, and the test fixtures. */
  useGh?: boolean;
}

export interface CheckPassed {
  readonly _tag: "CheckPassed";
  readonly reports: readonly CheckReport[];
  /** Set when zero-argument discovery found nothing. */
  readonly note?: string;
}

export interface CheckFailed {
  readonly _tag: "CheckFailed";
  readonly reports: readonly CheckReport[];
  /** Set when discovery itself failed before a report could be built. */
  readonly note?: string;
}

export type CheckOutcome = CheckPassed | CheckFailed;

type OutcomeFacets = { note?: string };

const checkPassed = (
  reports: readonly CheckReport[],
  /** Set when zero-argument discovery found nothing. */
  note?: string,
): CheckPassed => {
  const facets: OutcomeFacets = {};
  if (note !== undefined) facets.note = note;
  return { _tag: "CheckPassed", reports, ...facets };
};

const checkFailed = (
  reports: readonly CheckReport[],
  /** Set when discovery itself failed before a report could be built. */
  note?: string,
): CheckFailed => {
  const facets: OutcomeFacets = {};
  if (note !== undefined) facets.note = note;
  return { _tag: "CheckFailed", reports, ...facets };
};

/** Builds the outcome tag from report values; diagnostics never enter the Effect error channel. */
export const outcomeFromReports = (reports: readonly CheckReport[]): CheckOutcome =>
  reports.every((report) => report.ok) ? checkPassed(reports) : checkFailed(reports);

export const runCheck = Effect.fn("runCheck")(function* (options: CheckOptions) {
  const pathService = yield* Path.Path;
  const one = (path: string) => {
    const fileOptions: CheckFileOptions = { cwd: options.cwd, path };
    if (options.useGh !== undefined) fileOptions.useGh = options.useGh;
    return checkOne(fileOptions);
  };

  const explicit = options.paths ?? [];
  if (explicit.length > 0) {
    const reports = yield* Effect.forEach(explicit, one);
    return outcomeFromReports(reports);
  }

  const found = yield* Effect.result(discoverWalkthroughs(options.cwd));
  if (Result.isFailure(found)) {
    return found.failure._tag === "NotARepository"
      ? checkPassed([], "Not inside a git repository — nothing to check.")
      : checkFailed([], `Walkthrough discovery failed: ${discoveryErrorMessage(found.failure)}`);
  }
  const discovery = found.success;
  if (discovery.paths.length === 0) {
    return checkPassed([], NO_WALKTHROUGH);
  }
  const root = discovery.repoRoot;
  const reports = yield* Effect.forEach(discovery.paths, (path) =>
    one(pathService.join(root, path)),
  );
  return outcomeFromReports(reports);
});

/** The soft commands' report: `ok` asks only that a payload built; diagnostics ride along as error cards. */
export function softReport(loaded: LoadResult): CheckReport {
  return {
    file: loaded.sourcePath,
    ok: loaded.payload !== null,
    diagnostics: loaded.diagnostics,
    ranges: loaded.ranges,
  };
}

export const checkOne = Effect.fn("checkOne")(function* (options: CheckFileOptions) {
  const { cwd, path } = options;
  const loadOptions: LoadOptions = { cwd, path };
  if (options.resolution !== undefined) loadOptions.resolution = options.resolution;
  if (options.useGh !== undefined) loadOptions.useGh = options.useGh;
  return yield* loadWalkthrough(loadOptions).pipe(
    Effect.match({
      onFailure: (error): CheckReport => ({
        file: path,
        ok: false,
        diagnostics: [loadErrorDiagnostic(error)],
        ranges: [],
      }),
      onSuccess: (loaded): CheckReport => ({
        file: loaded.sourcePath,
        ok: !loaded.diagnostics.some((diagnostic) => diagnostic.level === "error"),
        diagnostics: loaded.diagnostics,
        ranges: loaded.ranges,
      }),
    }),
  );
});
