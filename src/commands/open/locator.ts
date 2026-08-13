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
} from "../../walkthrough/discovery.js";
import { CommandExecutor, gitOut } from "../../shell.js";
import {
  fetchPullHead,
  PullFetchFailed,
  repositoryRootForTarget,
  WrongRepository,
  type PrTarget,
} from "../../git/pr.js";
import type { LocatedSelection } from "../../server/session.js";
import { describeFailure } from "../../failure.js";

export class NoWalkthroughForPull extends Schema.TaggedErrorClass<NoWalkthroughForPull>()(
  "NoWalkthroughForPull",
  { number: Schema.Finite },
) {
  get note(): string {
    return (
      `PR #${this.number} carries no walkthrough. A walkthrough is a git-tracked ` +
      "`**/walkthroughs/*.md` file whose frontmatter holds the `walkthrough` key " +
      `— and \`pr: ${this.number}\`. Generate one with \`npx balade generate ${this.number}\`.`
    );
  }
}

export class PullSourceReadFailed extends Schema.TaggedErrorClass<PullSourceReadFailed>()(
  "PullSourceReadFailed",
  { path: Schema.String, cause: Schema.Defect() },
) {
  get note(): string {
    return `Could not read the walkthrough source at ${this.path} (${describeFailure(this.cause)}).`;
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

type LocatorDependencies = FileSystem.FileSystem | Path.Path | CommandExecutor;

export class PrLocator extends Context.Service<
  PrLocator,
  {
    readonly locate: (
      cwd: string,
      target: PrTarget,
    ) => Effect.Effect<LocatedSelection, LocateError>;
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
    const root = yield* repositoryRootForTarget(cwd, target);

    const discovered = yield* discoverWalkthroughs(cwd);
    const checkedOut = yield* naming(target.number, discovered.paths, (path) =>
      read(fs, pathService.join(root, path)),
    );
    if (checkedOut.length > 0) {
      return { kind: "workingTree", root, paths: checkedOut } satisfies LocatedSelection;
    }

    const at = yield* fetchPullHead(root, target.number);

    const heldPaths = yield* discoverWalkthroughsAt(root, at);
    const held = yield* naming(target.number, heldPaths, (path) =>
      gitOut(["show", `${at}:${path}`], root),
    );
    if (held.length === 0) return yield* new NoWalkthroughForPull({ number: target.number });
    return {
      kind: "pullHead",
      root,
      paths: held,
      number: target.number,
      at,
    } satisfies LocatedSelection;
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

const read = (fs: FileSystem.FileSystem, absolute: string) =>
  fs
    .readFileString(absolute)
    .pipe(Effect.mapError((cause) => new PullSourceReadFailed({ path: absolute, cause })));
