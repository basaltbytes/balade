/**
 * `check`: one pass over every walkthrough, every diagnostic with a
 * code, `file:line` where known, and a fix hint, plus the boundary echo of
 * every resolved code range.
 */

import { Effect, Path, Result } from "effect";
import { loadErrorDiagnostic, loadWalkthrough, type LoadResult } from "../compile/load.js";
import type { CheckReport } from "../payload/types.js";
import { discoveryErrorMessage, discoverWalkthroughs, NO_WALKTHROUGH } from "./discover.js";

export interface CheckFileOptions {
  cwd: string;
  /** Path of the walkthrough file, absolute or relative to `cwd`. */
  path: string;
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

export interface CheckOutcome {
  ok: boolean;
  reports: CheckReport[];
  /** Set when zero-argument discovery found nothing. */
  note?: string;
}

export const runCheck = Effect.fn("runCheck")(function* (options: CheckOptions) {
  const pathService = yield* Path.Path;
  const one = (path: string) =>
    checkOne({
      cwd: options.cwd,
      path,
      ...(options.useGh !== undefined ? { useGh: options.useGh } : {}),
    });

  const explicit = options.paths ?? [];
  if (explicit.length > 0) {
    const reports = yield* Effect.forEach(explicit, one);
    return { ok: reports.every((report) => report.ok), reports };
  }

  const found = yield* Effect.result(discoverWalkthroughs(options.cwd));
  if (Result.isFailure(found)) {
    return found.failure._tag === "NotARepository"
      ? { ok: true, reports: [], note: "Not inside a git repository — nothing to check." }
      : {
          ok: false,
          reports: [],
          note: `Walkthrough discovery failed: ${discoveryErrorMessage(found.failure)}`,
        };
  }
  const discovery = found.success;
  if (discovery.paths.length === 0) {
    return { ok: true, reports: [], note: NO_WALKTHROUGH };
  }
  const root = discovery.repoRoot;
  const reports = yield* Effect.forEach(discovery.paths, (path) =>
    one(pathService.join(root, path)),
  );
  return { ok: reports.every((report) => report.ok), reports };
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
  const loaded = yield* loadWalkthrough({
    cwd,
    path,
    ...(options.useGh !== undefined ? { useGh: options.useGh } : {}),
  }).pipe(
    Effect.match({
      onFailure: (error): LoadResult => ({
        sourcePath: path,
        payload: null,
        diagnostics: [loadErrorDiagnostic(error)],
        ranges: [],
      }),
      onSuccess: (result) => result,
    }),
  );
  return {
    file: loaded.sourcePath,
    ok: !loaded.diagnostics.some((diagnostic) => diagnostic.level === "error"),
    diagnostics: loaded.diagnostics,
    ranges: loaded.ranges,
  };
});
