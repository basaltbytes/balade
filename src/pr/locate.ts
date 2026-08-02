/**
 * Locating the walkthroughs a pull request names (spec #26, #27). Working tree
 * first — the branch may be checked out — then the PR's own ref: fetching
 * `pull/<n>/head` brings the artifact into the clone without touching the
 * checkout. Every failure mode is a typed error the CLI turns into a note.
 */

import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import {
  discoveryErrorMessage,
  discoverWalkthroughs,
  discoverWalkthroughsAt,
  type DiscoveryError,
  walkthroughPr,
} from "../check/discover.js";
import { CommandExecutor, gitOut, gitToplevel } from "../resolve/exec.js";
import { repoSlug } from "../resolve/git.js";
import type { PrTarget } from "./target.js";

export { NotARepository } from "../resolve/exec.js";

export class WrongRepository extends Schema.TaggedErrorClass<WrongRepository>()("WrongRepository", {
  wanted: Schema.String,
  found: Schema.String,
}) {
  get note(): string {
    return `The pull request lives in ${this.wanted}, but this repository's origin is ${this.found}.`;
  }
}

export class PullFetchFailed extends Schema.TaggedErrorClass<PullFetchFailed>()("PullFetchFailed", {
  number: Schema.Finite,
}) {
  get note(): string {
    return (
      `Could not fetch pull/${this.number}/head from origin. ` +
      "Serving a pull request without its branch checked out needs a GitHub origin and network access."
    );
  }
}

export class NoWalkthroughForPull extends Schema.TaggedErrorClass<NoWalkthroughForPull>()(
  "NoWalkthroughForPull",
  { number: Schema.Finite },
) {
  get note(): string {
    return (
      `PR #${this.number} carries no walkthrough. A walkthrough is a git-tracked ` +
      "`**/walkthroughs/*.md` file whose frontmatter holds the `walkthrough` key " +
      `— and \`pr: ${this.number}\`.`
    );
  }
}

export class PullSourceReadFailed extends Schema.TaggedErrorClass<PullSourceReadFailed>()(
  "PullSourceReadFailed",
  { path: Schema.String, cause: Schema.Defect() },
) {
  get note(): string {
    return `Could not read the walkthrough source at ${this.path}.`;
  }
}

export type LocateError =
  | DiscoveryError
  | WrongRepository
  | PullFetchFailed
  | NoWalkthroughForPull
  | PullSourceReadFailed;

export function locateErrorMessage(error: LocateError): string {
  switch (error._tag) {
    case "NotARepository":
    case "CommandFailed":
    case "WalkthroughReadFailed":
      return discoveryErrorMessage(error);
    case "WrongRepository":
    case "PullFetchFailed":
    case "NoWalkthroughForPull":
    case "PullSourceReadFailed":
      return error.note;
  }
}

export interface Located {
  /** Absolute repository root. */
  root: string;
  /** Repo-relative walkthrough paths naming the PR, sorted. */
  paths: readonly string[];
  /** The commit the sources are read at; absent when the working tree holds them. */
  at?: string;
}

type LocatorDependencies = FileSystem.FileSystem | Path.Path | CommandExecutor;

export class PrLocator extends Context.Service<
  PrLocator,
  {
    readonly locate: (cwd: string, target: PrTarget) => Effect.Effect<Located, LocateError>;
  }
>()("@balade/PrLocator") {
  static readonly layer = Layer.effect(
    PrLocator,
    Effect.gen(function* () {
      const dependencies = Context.pick(
        FileSystem.FileSystem,
        Path.Path,
        CommandExecutor,
      )(yield* Effect.context<LocatorDependencies>());
      return {
        locate: Effect.fn("PrLocator.locate")((cwd: string, target: PrTarget) =>
          locate(cwd, target).pipe(Effect.provide(dependencies)),
        ),
      };
    }),
  );
}

const locate = (cwd: string, target: PrTarget) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const root = yield* gitToplevel(cwd);

    const slug = yield* repoSlug(root);
    if (target.slug !== null && target.slug.toLowerCase() !== slug.toLowerCase()) {
      return yield* new WrongRepository({ wanted: target.slug, found: slug });
    }

    const discovered = yield* discoverWalkthroughs(cwd);
    const checkedOut = yield* naming(target.number, discovered.paths, (path) =>
      read(fs, pathService.join(root, path)),
    );
    if (checkedOut.length > 0) return { root, paths: checkedOut };

    const at = yield* fetchPullHead(root, target.number);

    const heldPaths = yield* discoverWalkthroughsAt(root, at);
    const held = yield* naming(target.number, heldPaths, (path) =>
      gitOut(["show", `${at}:${path}`], root),
    );
    if (held.length === 0) return yield* new NoWalkthroughForPull({ number: target.number });
    return { root, paths: held, at };
  });

/** The walkthroughs whose frontmatter names this PR number. */
const naming = <E, R>(
  number: number,
  paths: readonly string[],
  sourceOf: (path: string) => Effect.Effect<string, E, R>,
): Effect.Effect<string[], E, R> =>
  Effect.gen(function* () {
    const found: string[] = [];
    for (const path of paths) {
      const source = yield* sourceOf(path);
      const namesPull = Option.match(walkthroughPr(source), {
        onNone: () => false,
        onSome: (pr) => pr === number,
      });
      if (namesPull) found.push(path);
    }
    return found;
  });

/** GitHub advertises every PR head as `pull/<n>/head`; the SHA lands in FETCH_HEAD. */
const fetchPullHead = (root: string, number: number) =>
  Effect.gen(function* () {
    yield* gitOut(["fetch", "--quiet", "origin", `pull/${number}/head`], root);
    const at = (yield* gitOut(["rev-parse", "FETCH_HEAD"], root)).trim();
    return at === "" ? yield* new PullFetchFailed({ number }) : at;
  }).pipe(Effect.mapError(() => new PullFetchFailed({ number })));

const read = (fs: FileSystem.FileSystem, absolute: string) =>
  fs
    .readFileString(absolute)
    .pipe(Effect.mapError((cause) => new PullSourceReadFailed({ path: absolute, cause })));
