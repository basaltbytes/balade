/**
 * What `open` puts together before the port opens: which walkthroughs this run
 * serves, the payload cache in front of the resolver, the review-state files,
 * and a watcher that drops a cached payload when its file changes.
 *
 * Preparation is an Effect: discovery, path resolution and eager compilation
 * preserve their failures until the CLI boundary. Domain diagnostics remain in
 * the reports produced during eager compilation.
 */

import { Effect, FileSystem, Layer, Match, Path, Stream } from "effect";
import {
  discoverWalkthroughs,
  NO_WALKTHROUGH,
  NOT_A_REPO,
  type DiscoveryError,
} from "../check/discover.js";
import { softReport } from "../check/run.js";
import type { LoadError } from "../compile/load.js";
import { describeFailure } from "../failure.js";
import type { CheckReport } from "../payload/types.js";
import { gitToplevel } from "../resolve/exec.js";
import { repoRelative, type PathResolutionFailed } from "../resolve/paths.js";
import { ReviewStateStore } from "../state/store.js";
import { createApi, type Api } from "./api.js";
import { PayloadCache } from "./cache.js";
import { ServerRepo, type ServerRepoError } from "./repo.js";

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
}

export interface Session {
  api: Api;
  /** Served walkthroughs, repo-relative. */
  paths: readonly string[];
  /** Diagnostics of the eager compile — warnings, and the soft errors that still serve. */
  reports: readonly CheckReport[];
}

/** Ready to serve; reports may still carry warnings and renderable error cards. */
export interface SessionReady {
  readonly _tag: "SessionReady";
  readonly session: Session;
}

/** Nothing to serve, and the sentence that says why. */
export interface SessionNotStarted {
  readonly _tag: "SessionNotStarted";
  readonly message: string;
}

/** A dead repository, PR or file: `open` prints this and stops. */
export interface SessionFailed {
  readonly _tag: "SessionFailed";
  readonly reports: readonly CheckReport[];
}

export type Prepared = SessionReady | SessionNotStarted | SessionFailed;

type Selected =
  | { readonly _tag: "SessionSelected"; root: string; paths: readonly string[]; at?: string }
  | SessionNotStarted;

export type SessionError = DiscoveryError | LoadError | PathResolutionFailed | ServerRepoError;

export function sessionErrorMessage(error: SessionError): string {
  return Match.valueTags(error, {
    NotARepository: ({ note }) => note,
    CommandFailed: ({ file, args, code }) => `${file} ${args.join(" ")} failed (exit ${code}).`,
    WalkthroughReadFailed: ({ path, cause }) =>
      `Could not read ${path} (${describeFailure(cause)}).`,
    WalkthroughFileReadFailed: ({ path, cause }) =>
      `Could not read ${path} (${describeFailure(cause)}).`,
    ServerSourceReadFailed: ({ path, cause }) =>
      `Could not read ${path} (${describeFailure(cause)}).`,
    CommitUnresolvable: ({ commit }) => `The stamped commit ${commit} is not in this clone.`,
    PathResolutionFailed: ({ path, cause }) =>
      `Could not resolve ${path} (${describeFailure(cause)}).`,
  });
}

/** Named files are made repo-relative; discovery and the locator already answer in that shape. */
const select = Effect.fn("selectSession")(function* (options: SessionOptions) {
  const pathService = yield* Path.Path;
  if (options.selection.kind === "located") {
    const { root, paths, at } = options.selection;
    return {
      _tag: "SessionSelected",
      root,
      paths,
      ...(at === undefined ? {} : { at }),
    } satisfies Selected;
  }

  if (options.selection.kind === "discovered") {
    return yield* discoverWalkthroughs(options.cwd).pipe(
      Effect.map(
        (found): Selected =>
          found.paths.length === 0
            ? { _tag: "SessionNotStarted", message: NO_WALKTHROUGH }
            : { _tag: "SessionSelected", root: found.repoRoot, paths: found.paths },
      ),
      Effect.catchTag("NotARepository", () =>
        Effect.succeed<Selected>({ _tag: "SessionNotStarted", message: NOT_A_REPO }),
      ),
    );
  }

  const root = yield* gitToplevel(options.cwd).pipe(
    Effect.catchTag("NotARepository", () => Effect.void),
  );
  if (root === undefined) {
    return { _tag: "SessionNotStarted", message: NOT_A_REPO } satisfies Selected;
  }
  const paths: string[] = [];
  for (const path of options.selection.paths) {
    paths.push(
      yield* repoRelative(
        root,
        pathService.isAbsolute(path) ? path : pathService.resolve(options.cwd, path),
      ),
    );
  }
  return (
    paths.length === 0
      ? { _tag: "SessionNotStarted", message: NO_WALKTHROUGH }
      : { _tag: "SessionSelected", root, paths }
  ) satisfies Selected;
});

export const prepareSession = Effect.fn("prepareSession")(function* (options: SessionOptions) {
  const selected = yield* select(options);
  if (selected._tag === "SessionNotStarted") return selected;
  const { root, paths, at } = selected;

  const repoLayer = ServerRepo.layer({
    root,
    ...(at === undefined ? {} : { at }),
    ...(options.lang !== undefined ? { lang: options.lang } : {}),
    ...(options.useGh !== undefined ? { useGh: options.useGh } : {}),
  });
  const payloadLayer = PayloadCache.layer.pipe(Layer.provideMerge(repoLayer));
  const stateLayer = ReviewStateStore.layer({ repoRoot: root });
  const sessionLayer = Layer.mergeAll(payloadLayer, stateLayer);

  return yield* Effect.gen(function* () {
    /* Named files and located PRs compile before the port opens, so a dead
       repository, PR or path stops the command instead of greeting the reviewer
       with a blank app. Discovery serves an index, which needs frontmatter only. */
    const reports = options.selection.kind === "discovered" ? [] : yield* compileEagerly(paths);
    if (reports.some((report) => !report.ok)) {
      return { _tag: "SessionFailed", reports } satisfies SessionFailed;
    }

    const api = yield* createApi(paths);

    /* Content at a fetched commit is immutable: ref mode has nothing to watch. */
    if (at === undefined) yield* watchWalkthroughs(root, paths);
    return { _tag: "SessionReady", session: { api, paths, reports } } satisfies SessionReady;
  }).pipe(Effect.provide(sessionLayer));
});

/**
 * A payload is dead when the compiler could not build one at all — no
 * repository, no PR, no file. An unresolvable range is not: it rides along as
 * an in-app error card (#15, soft `open`).
 */
const compileEagerly = Effect.fn("compileEagerly")(function* (paths: readonly string[]) {
  const payloads = yield* PayloadCache;
  return yield* Effect.forEach(paths, (path) => payloads.get(path).pipe(Effect.map(softReport)));
});

/**
 * Directories, not files: an editor that saves through a rename replaces the
 * inode a file watcher holds, and the change is then never seen.
 */
const watchWalkthroughs = Effect.fn("watchWalkthroughs")(function* (
  root: string,
  paths: readonly string[],
) {
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const cache = yield* PayloadCache;
  const byDirectory = new Map<string, string[]>();
  for (const path of paths) {
    const directory = pathService.dirname(path);
    byDirectory.set(directory, [...(byDirectory.get(directory) ?? []), path]);
  }

  for (const [directory, served] of byDirectory) {
    yield* fs.watch(pathService.join(root, directory)).pipe(
      Stream.runForEach(() => Effect.forEach(served, cache.invalidate, { discard: true })),
      Effect.catch((error) =>
        Effect.logWarning(
          `balade: no file watcher on ${directory} (${describeFailure(error)}). ` +
            "Restart balade to pick up edits to the walkthrough.",
        ),
      ),
      Effect.forkScoped,
    );
  }
});
