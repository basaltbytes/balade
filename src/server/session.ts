/**
 * What `open` puts together before the port opens: which walkthroughs this run
 * serves, the payload cache in front of the resolver, the review-state files,
 * and a watcher that drops a cached payload when its file changes.
 *
 * Preparation is an Effect: discovery, path resolution and eager compilation
 * preserve their failures until the CLI boundary. Domain diagnostics remain in
 * the successful check outcome.
 */

import { watch, type FSWatcher } from "node:fs";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { Effect } from "effect";
import {
  discoverWalkthroughs,
  NO_WALKTHROUGH,
  NOT_A_REPO,
  type DiscoveryError,
} from "../check/discover.js";
import { softReport, type CheckOutcome } from "../check/run.js";
import type { LoadError } from "../compile/load.js";
import { describeFailure } from "../failure.js";
import { gitToplevel } from "../resolve/exec.js";
import { repoRelative, type PathResolutionFailed } from "../resolve/paths.js";
import { fileReviewStore } from "../state/store.js";
import { createApi, type Api } from "./api.js";
import { payloadCache, type PayloadCache } from "./cache.js";
import { serverRepo, type ServerRepo, type ServerRepoError } from "./repo.js";

/**
 * Where the served set comes from: the command line, discovery, or the PR
 * locator. A located selection already answers repo-relative paths; `at` is the
 * fetched commit the sources are read from when the branch is not checked out.
 */
export type Selection =
  | { kind: "files"; paths: readonly string[] }
  | { kind: "discovered" }
  | { kind: "located"; root: string; paths: readonly string[]; at?: string };

export interface SessionOptions {
  cwd: string;
  selection: Selection;
  /** Chrome language override (`--lang`). */
  lang?: "en" | "fr";
  /** `false` skips gh entirely. */
  useGh?: boolean;
  /** Where file-watcher failures are reported after the session has started. */
  warn?: (message: string) => void;
}

export interface Session {
  api: Api;
  /** Served walkthroughs, repo-relative. */
  paths: readonly string[];
  /** Diagnostics of the eager compile — warnings, and the soft errors that still serve. */
  outcome: CheckOutcome;
  /** Stops the file watcher. */
  close(): void;
}

export type Prepared =
  /** Ready to serve; `outcome` may still carry warnings and error cards. */
  | { kind: "ready"; session: Session }
  /** Nothing to serve, and the sentence that says why. */
  | { kind: "note"; message: string }
  /** A dead repository, PR or file: `open` prints this and stops. */
  | { kind: "failed"; outcome: CheckOutcome };

type Selected =
  | { kind: "ok"; root: string; paths: readonly string[]; at?: string }
  | { kind: "note"; message: string };

export type SessionError = DiscoveryError | LoadError | PathResolutionFailed | ServerRepoError;

export function sessionErrorMessage(error: SessionError): string {
  switch (error._tag) {
    case "NotARepository":
      return error.note;
    case "CommandFailed":
      return `${error.file} ${error.args.join(" ")} failed (exit ${error.code}).`;
    case "WalkthroughReadFailed":
    case "WalkthroughFileReadFailed":
    case "ServerSourceReadFailed":
      return `Could not read ${error.path} (${describeFailure(error.cause)}).`;
    case "CommitUnresolvable":
      return `The stamped commit ${error.commit} is not in this clone.`;
    case "PathResolutionFailed":
      return `Could not resolve ${error.path} (${describeFailure(error.cause)}).`;
  }
}

/** Named files are made repo-relative; discovery and the locator already answer in that shape. */
const select = Effect.fn("selectSession")(function* (options: SessionOptions) {
  if (options.selection.kind === "located") {
    const { root, paths, at } = options.selection;
    return { kind: "ok", root, paths, ...(at === undefined ? {} : { at }) } satisfies Selected;
  }

  if (options.selection.kind === "discovered") {
    return yield* discoverWalkthroughs(options.cwd).pipe(
      Effect.map(
        (found): Selected =>
          found.paths.length === 0
            ? { kind: "note", message: NO_WALKTHROUGH }
            : { kind: "ok", root: found.repoRoot, paths: found.paths },
      ),
      Effect.catchTag("NotARepository", () =>
        Effect.succeed<Selected>({ kind: "note", message: NOT_A_REPO }),
      ),
    );
  }

  const root = yield* gitToplevel(options.cwd).pipe(
    Effect.catchTag("NotARepository", () => Effect.void),
  );
  if (root === undefined) return { kind: "note", message: NOT_A_REPO } satisfies Selected;
  const paths: string[] = [];
  for (const path of options.selection.paths) {
    paths.push(yield* repoRelative(root, isAbsolute(path) ? path : resolvePath(options.cwd, path)));
  }
  return (
    paths.length === 0 ? { kind: "note", message: NO_WALKTHROUGH } : { kind: "ok", root, paths }
  ) satisfies Selected;
});

export const prepareSession = Effect.fn("prepareSession")(function* (options: SessionOptions) {
  const warn = options.warn ?? ((message: string) => process.stderr.write(`${message}\n`));

  const selected = yield* select(options);
  if (selected.kind === "note") return selected;
  const { root, paths, at } = selected;

  const repo: ServerRepo = yield* serverRepo({
    root,
    ...(at === undefined ? {} : { at }),
    ...(options.lang !== undefined ? { lang: options.lang } : {}),
    ...(options.useGh !== undefined ? { useGh: options.useGh } : {}),
  });
  const payloads = payloadCache(repo);

  /* Named files and located PRs compile before the port opens, so a dead
     repository, PR or path stops the command instead of greeting the reviewer
     with a blank app. Discovery serves an index, which needs frontmatter only. */
  const outcome =
    options.selection.kind === "discovered"
      ? ({ ok: true, reports: [] } satisfies CheckOutcome)
      : yield* compileEagerly(payloads, paths);
  if (!outcome.ok) return { kind: "failed", outcome } satisfies Prepared;

  const api = createApi({
    paths,
    payloads,
    state: fileReviewStore({ repoRoot: root }),
    repo,
  });

  /* Content at a fetched commit is immutable: ref mode has nothing to watch. */
  return {
    kind: "ready",
    session: {
      api,
      paths,
      outcome,
      close:
        at === undefined ? watchWalkthroughs({ root, paths, cache: payloads, warn }) : () => {},
    },
  } satisfies Prepared;
});

/**
 * A payload is dead when the compiler could not build one at all — no
 * repository, no PR, no file. An unresolvable range is not: it rides along as
 * an in-app error card (#15, soft `open`).
 */
const compileEagerly = Effect.fn("compileEagerly")(function* (
  payloads: PayloadCache,
  paths: readonly string[],
) {
  const reports = yield* Effect.forEach(paths, (path) =>
    payloads.get(path).pipe(Effect.map(softReport)),
  );
  return { ok: reports.every((report) => report.ok), reports };
});

/**
 * Directories, not files: an editor that saves through a rename replaces the
 * inode a file watcher holds, and the change is then never seen.
 */
function watchWalkthroughs(options: {
  root: string;
  paths: readonly string[];
  cache: PayloadCache;
  warn: (message: string) => void;
}): () => void {
  const watchers: FSWatcher[] = [];
  const byDirectory = new Map<string, string[]>();
  for (const path of options.paths) {
    const directory = dirname(path);
    byDirectory.set(directory, [...(byDirectory.get(directory) ?? []), path]);
  }

  /* A watcher that never starts costs freshness, not correctness: the payloads
     stay as they were compiled until the CLI restarts, so it is said out loud. */
  const lost = (directory: string, reason: unknown): void => {
    options.warn(
      `balade: no file watcher on ${directory} (${reason instanceof Error ? reason.message : String(reason)}). ` +
        "Restart balade to pick up edits to the walkthrough.",
    );
  };

  for (const [directory, served] of byDirectory) {
    try {
      const watcher = watch(join(options.root, directory), (_event, filename) => {
        if (filename === null) {
          for (const path of served) options.cache.invalidate(path);
          return;
        }
        const name = String(filename);
        options.cache.invalidate(directory === "." ? name : `${directory}/${name}`);
      });
      watcher.on("error", (error) => {
        watcher.close();
        lost(directory, error);
      });
      watchers.push(watcher);
    } catch (error) {
      lost(directory, error);
    }
  }

  return () => {
    for (const watcher of watchers) watcher.close();
  };
}
