/**
 * Balade-owned state on disk: the predictable `~/.balade` home directories,
 * and the review/Q&A stores — one JSON file of each kind per walkthrough under
 * `.balade/` at the repository root, named after the walkthrough file
 * (`pr-96-loan-refactor.md` → `pr-96-loan-refactor.review.json` / `.qa.json`).
 *
 * The state directory is excluded through the clone's `info/exclude` (in the
 * git common directory) rather than the committed `.gitignore`, so a
 * reviewer's marks never touch the repository.
 * A missing or mismatched file is legitimate absence. Unreadable, corrupt and
 * unwritable state stays in the typed error channel for the server boundary to
 * report or log deliberately.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { parseQaJson, type QaParseError } from "./contract/qa-parser.js";
import { parseReviewJson, type ReviewParseError } from "./contract/review-parser.js";
import type { QaState, ReviewState } from "./contract/types.js";

/* ------------------------------------------------------------------ */
/* Predictable balade-owned state below the user's home directory      */
/* ------------------------------------------------------------------ */

export function baladeStateDirectory(): string {
  return join(homedir(), ".balade");
}

export function baladePiAgentDirectory(): string {
  return join(baladeStateDirectory(), "pi");
}

export function baladeSnapshotCacheDirectory(): string {
  return join(baladeStateDirectory(), "cache", "snapshots");
}

const STATE_DIR = ".balade";

/** The exclude line, with the trailing slash git wants for a directory. */
const EXCLUDE_LINE = `${STATE_DIR}/`;

export interface ReviewStateStorePort {
  /** The stored state, or `None` when there is none this walkthrough can use. */
  readonly read: (sourcePath: string) => Effect.Effect<Option.Option<ReviewState>, StateReadError>;
  readonly write: (sourcePath: string, state: ReviewState) => Effect.Effect<void, StateWriteFailed>;
}

export class ReviewStateStore extends Context.Service<ReviewStateStore, ReviewStateStorePort>()(
  "@balade/ReviewStateStore",
) {
  static layer(options: FileStoreOptions) {
    return Layer.effect(
      ReviewStateStore,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        return makeReviewStateStore(options, fs, path);
      }),
    );
  }
}

/** `walkthroughs/pr-96-loan-refactor.md` → `pr-96-loan-refactor.review.json`. */
export function stateFileName(sourcePath: string): string {
  return sidecarFileName(sourcePath, "review");
}

/** `walkthroughs/pr-96-loan-refactor.md` → `pr-96-loan-refactor.qa.json`. */
export function qaFileName(sourcePath: string): string {
  return sidecarFileName(sourcePath, "qa");
}

function sidecarFileName(sourcePath: string, kind: "review" | "qa"): string {
  const name = sourcePath.slice(sourcePath.lastIndexOf("/") + 1);
  const stem = name.endsWith(".md") ? name.slice(0, -".md".length) : name;
  return `${stem}.${kind}.json`;
}

export class StateReadFailed extends Schema.TaggedErrorClass<StateReadFailed>()("StateReadFailed", {
  path: Schema.String,
  cause: Schema.Defect(),
}) {}

export class StateInvalid extends Schema.TaggedErrorClass<StateInvalid>()("StateInvalid", {
  path: Schema.String,
  cause: Schema.Defect(),
}) {}

export class StateWriteFailed extends Schema.TaggedErrorClass<StateWriteFailed>()(
  "StateWriteFailed",
  { path: Schema.String, cause: Schema.Defect() },
) {}

export class StateExcludeFailed extends Schema.TaggedErrorClass<StateExcludeFailed>()(
  "StateExcludeFailed",
  { path: Schema.String, cause: Schema.Defect() },
) {}

export type StateReadError = StateReadFailed | StateInvalid;

export interface QaStateStorePort {
  readonly read: (sourcePath: string) => Effect.Effect<Option.Option<QaState>, StateReadError>;
  readonly write: (sourcePath: string, state: QaState) => Effect.Effect<void, StateWriteFailed>;
}

export class QaStateStore extends Context.Service<QaStateStore, QaStateStorePort>()(
  "@balade/QaStateStore",
) {
  static layer(options: FileStoreOptions) {
    return Layer.effect(
      QaStateStore,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        return makeQaStateStore(options, fs, path);
      }),
    );
  }
}

export interface FileStoreOptions {
  /** Repository root; the state directory is `<repoRoot>/.balade/`. */
  repoRoot: string;
  /**
   * Absolute git common directory — where `info/exclude` lives. In a linked
   * worktree or a submodule `<repoRoot>/.git` is a pointer file, so the caller
   * resolves the real directory (`git rev-parse --git-common-dir`).
   */
  gitCommonDir: string;
}

function makeReviewStateStore(
  options: FileStoreOptions,
  fs: FileSystem.FileSystem,
  path: Path.Path,
): ReviewStateStorePort {
  return makeSidecarStore<ReviewState, ReviewParseError>(options, fs, path, {
    service: "ReviewStateStore",
    fileName: stateFileName,
    parse: parseReviewJson,
    excludeWarning: "review state",
  });
}

function makeQaStateStore(
  options: FileStoreOptions,
  fs: FileSystem.FileSystem,
  path: Path.Path,
): QaStateStorePort {
  return makeSidecarStore<QaState, QaParseError>(options, fs, path, {
    service: "QaStateStore",
    fileName: qaFileName,
    parse: parseQaJson,
    excludeWarning: "Q&A state",
  });
}

interface SidecarStore<State> {
  readonly read: (sourcePath: string) => Effect.Effect<Option.Option<State>, StateReadError>;
  readonly write: (sourcePath: string, state: State) => Effect.Effect<void, StateWriteFailed>;
}

interface SidecarPolicy<State, ParseError> {
  readonly service: string;
  readonly fileName: (sourcePath: string) => string;
  readonly parse: (raw: string) => Effect.Effect<State, ParseError>;
  readonly excludeWarning: string;
}

function makeSidecarStore<State extends { readonly walkthrough: string }, ParseError>(
  options: FileStoreOptions,
  fs: FileSystem.FileSystem,
  path: Path.Path,
  policy: SidecarPolicy<State, ParseError>,
): SidecarStore<State> {
  const dir = path.join(options.repoRoot, STATE_DIR);
  const fileFor = (sourcePath: string): string => path.join(dir, policy.fileName(sourcePath));

  return {
    read: Effect.fn(`${policy.service}.read`)(function* (sourcePath) {
      const file = fileFor(sourcePath);
      const raw = yield* fs.readFileString(file).pipe(
        Effect.map(Option.some),
        Effect.catch((cause) =>
          cause.reason._tag === "NotFound"
            ? Effect.succeed(Option.none())
            : new StateReadFailed({ path: file, cause }),
        ),
      );
      if (Option.isNone(raw)) return Option.none();

      const stored = yield* policy
        .parse(raw.value)
        .pipe(Effect.mapError((cause) => new StateInvalid({ path: file, cause })));
      /* Two walkthroughs of the same filename share a sidecar name. The
         serialized owner prevents one from inheriting the other's state. */
      return stored.walkthrough === sourcePath ? Option.some(stored) : Option.none();
    }),

    write: Effect.fn(`${policy.service}.write`)(function* (sourcePath, state) {
      const file = fileFor(sourcePath);
      yield* fs
        .makeDirectory(dir, { recursive: true })
        .pipe(Effect.mapError((cause) => new StateWriteFailed({ path: file, cause })));
      yield* Effect.gen(function* () {
        const temporary = yield* fs.makeTempFileScoped({
          directory: dir,
          prefix: ".balade-sidecar-write-",
        });
        yield* fs.writeFileString(temporary, `${JSON.stringify(state, null, 2)}\n`);
        yield* fs.rename(temporary, file);
      }).pipe(
        Effect.scoped,
        Effect.mapError((cause) => new StateWriteFailed({ path: file, cause })),
      );
      yield* excludeStateDir(fs, path, options.gitCommonDir).pipe(
        Effect.catchTag("StateExcludeFailed", (error) =>
          Effect.logWarning(
            `balade: could not add .balade/ to ${error.path}; add it yourself to keep ${policy.excludeWarning} out of git.`,
            error,
          ),
        ),
      );
    }),
  };
}

/**
 * Appends `.balade/` to the clone's `info/exclude` when it is not already
 * there. The file belongs to the clone, not to the repository, so writing it
 * commits the reviewer to nothing. It sits in the git common directory, which
 * a linked worktree shares with the main checkout, so one line covers both.
 */
function excludeStateDir(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  gitCommonDir: string,
): Effect.Effect<void, StateExcludeFailed> {
  const info = path.join(gitCommonDir, "info");
  const file = path.join(info, "exclude");

  return Effect.gen(function* () {
    const current = yield* fs
      .readFileString(file)
      .pipe(
        Effect.catch((cause) =>
          cause.reason._tag === "NotFound"
            ? Effect.succeed("")
            : new StateExcludeFailed({ path: file, cause }),
        ),
      );
    if (current.split("\n").some((line) => line.trim() === EXCLUDE_LINE)) return;

    const separator = current === "" || current.endsWith("\n") ? "" : "\n";
    yield* fs
      .makeDirectory(info, { recursive: true })
      .pipe(Effect.mapError((cause) => new StateExcludeFailed({ path: file, cause })));
    yield* fs
      .writeFileString(file, `${separator}${EXCLUDE_LINE}\n`, { flag: "a" })
      .pipe(Effect.mapError((cause) => new StateExcludeFailed({ path: file, cause })));
  });
}
