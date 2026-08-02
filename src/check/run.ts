/**
 * `check`: one pass over every walkthrough, every diagnostic with a
 * code, `file:line` where known, and a fix hint, plus the boundary echo of
 * every resolved code range.
 */

import { join } from "node:path";
import { Effect } from "effect";
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

export function runCheck(options: CheckOptions): CheckOutcome {
  const one = (path: string): CheckReport =>
    checkOne({
      cwd: options.cwd,
      path,
      ...(options.useGh !== undefined ? { useGh: options.useGh } : {}),
    });

  const explicit = options.paths ?? [];
  if (explicit.length > 0) {
    const reports = explicit.map(one);
    return { ok: reports.every((report) => report.ok), reports };
  }

  const found = Effect.runSync(
    discoverWalkthroughs(options.cwd).pipe(
      Effect.match({
        onFailure: (error) => ({
          kind: "failure" as const,
          error,
        }),
        onSuccess: (discovery) => ({ kind: "success" as const, discovery }),
      }),
    ),
  );
  if (found.kind === "failure") {
    return found.error._tag === "NotARepository"
      ? { ok: true, reports: [], note: "Not inside a git repository — nothing to check." }
      : {
          ok: false,
          reports: [],
          note: `Walkthrough discovery failed: ${discoveryErrorMessage(found.error)}`,
        };
  }
  const { discovery } = found;
  if (discovery.paths.length === 0) {
    return { ok: true, reports: [], note: NO_WALKTHROUGH };
  }
  const root = discovery.repoRoot;
  const reports = discovery.paths.map((path) => one(join(root, path)));
  return { ok: reports.every((report) => report.ok), reports };
}

/** The soft commands' report: `ok` asks only that a payload built; diagnostics ride along as error cards. */
export function softReport(loaded: LoadResult): CheckReport {
  return {
    file: loaded.sourcePath,
    ok: loaded.payload !== null,
    diagnostics: loaded.diagnostics,
    ranges: loaded.ranges,
  };
}

export function checkOne(options: CheckFileOptions): CheckReport {
  const { cwd, path } = options;
  const loaded = Effect.runSync(
    loadWalkthrough({
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
    ),
  );
  return {
    file: loaded.sourcePath,
    ok: !loaded.diagnostics.some((diagnostic) => diagnostic.level === "error"),
    diagnostics: loaded.diagnostics,
    ranges: loaded.ranges,
  };
}
