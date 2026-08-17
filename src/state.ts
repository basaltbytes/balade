/**
 * Balade-owned state on disk: the predictable `~/.balade` home directories,
 * and the review/Q&A stores — one JSON file of each kind per walkthrough under
 * `.balade/` at the repository root, mirroring the walkthrough's repo-relative
 * path (`docs/walkthroughs/pr-96.md` →
 * `.balade/docs/walkthroughs/pr-96.md.review.json` / `.qa.json`).
 *
 * The state directory is excluded through the clone's `info/exclude` (in the
 * git common directory) rather than the committed `.gitignore`, so a
 * review data never touches the tracked repository.
 * A missing or mismatched file is legitimate absence. Unreadable, corrupt and
 * unwritable state stays in the typed error channel for the server boundary to
 * report or log deliberately.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { parseQaJson, type QaParseError } from "./contract/qa-parser.js";
import { parseReviewJson, type ReviewParseError } from "./contract/review-parser.js";
import { isContainedRepoRelativePath } from "./contract/paths.js";
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
  readonly write: (sourcePath: string, state: ReviewState) => Effect.Effect<void, StateWriteError>;
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

/** `walkthroughs/pr-96.md` → `walkthroughs/pr-96.md.review.json`. */
export function stateFilePath(sourcePath: string): string {
  return sidecarFilePath(sourcePath, "review");
}

/** `walkthroughs/pr-96.md` → `walkthroughs/pr-96.md.qa.json`. */
export function qaFilePath(sourcePath: string): string {
  return sidecarFilePath(sourcePath, "qa");
}

function sidecarFilePath(sourcePath: string, kind: "review" | "qa"): string {
  return `${sourcePath}.${kind}.json`;
}

export class StatePathRejected extends Schema.TaggedErrorClass<StatePathRejected>()(
  "StatePathRejected",
  { path: Schema.String },
) {}

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

export type StateReadError = StatePathRejected | StateReadFailed | StateInvalid;
export type StateWriteError = StatePathRejected | StateWriteFailed;

export interface QaStateStorePort {
  readonly read: (sourcePath: string) => Effect.Effect<Option.Option<QaState>, StateReadError>;
  readonly write: (sourcePath: string, state: QaState) => Effect.Effect<void, StateWriteError>;
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
    filePath: stateFilePath,
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
    filePath: qaFilePath,
    parse: parseQaJson,
    excludeWarning: "Q&A state",
  });
}

interface SidecarStore<State> {
  readonly read: (sourcePath: string) => Effect.Effect<Option.Option<State>, StateReadError>;
  readonly write: (sourcePath: string, state: State) => Effect.Effect<void, StateWriteError>;
}

interface SidecarPolicy<State, ParseError> {
  readonly service: string;
  readonly filePath: (sourcePath: string) => string;
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
  const expectedFile = (sourcePath: string): string => path.join(dir, policy.filePath(sourcePath));

  return {
    read: Effect.fn(`${policy.service}.read`)(function* (sourcePath) {
      const selected = yield* safeSidecarFile(
        options.repoRoot,
        sourcePath,
        policy.filePath(sourcePath),
        "read",
        fs,
        path,
      ).pipe(
        Effect.mapError((cause) =>
          cause._tag === "StatePathRejected"
            ? cause
            : new StateReadFailed({ path: expectedFile(sourcePath), cause }),
        ),
      );
      if (Option.isNone(selected)) return Option.none();
      const file = selected.value;
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
      /* The serialized owner still guards against a moved or manually copied
         sidecar being read under a different walkthrough path. */
      return stored.walkthrough === sourcePath ? Option.some(stored) : Option.none();
    }),

    write: Effect.fn(`${policy.service}.write`)(function* (sourcePath, state) {
      const file = yield* prepareSafeSidecarFile(
        options.repoRoot,
        sourcePath,
        policy.filePath(sourcePath),
        fs,
        path,
      ).pipe(
        Effect.mapError((cause) =>
          cause._tag === "StatePathRejected"
            ? cause
            : new StateWriteFailed({ path: expectedFile(sourcePath), cause }),
        ),
      );
      const fileDirectory = path.dirname(file);
      yield* Effect.gen(function* () {
        const temporary = yield* fs.makeTempFileScoped({
          directory: fileDirectory,
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

type SidecarAccess = "read" | "write";

/** Resolve every existing path component before any write can follow it. */
const safeSidecarFile = Effect.fn("SidecarStore.safeFile")(function* (
  repoRoot: string,
  sourcePath: string,
  relativeFile: string,
  access: SidecarAccess,
  fs: FileSystem.FileSystem,
  path: Path.Path,
): Effect.fn.Return<Option.Option<string>, StatePathRejected | PlatformError> {
  if (!isContainedRepoRelativePath(sourcePath) || path.isAbsolute(sourcePath)) {
    return yield* new StatePathRejected({ path: sourcePath });
  }

  const canonicalRepoRoot = yield* fs.realPath(repoRoot);
  const lexicalRoot = path.join(repoRoot, STATE_DIR);
  const canonicalRoot = path.join(canonicalRepoRoot, STATE_DIR);
  const root = yield* prepareSafeDirectory(
    lexicalRoot,
    canonicalRoot,
    sourcePath,
    access,
    fs,
    path,
  );
  if (Option.isNone(root)) return Option.none();

  const segments = relativeFile.split("/");
  const name = segments.at(-1);
  if (name === undefined) return yield* new StatePathRejected({ path: sourcePath });
  let lexicalDirectory = lexicalRoot;
  let canonicalDirectory = canonicalRoot;
  for (const segment of segments.slice(0, -1)) {
    lexicalDirectory = path.join(lexicalDirectory, segment);
    canonicalDirectory = path.join(canonicalDirectory, segment);
    const directory = yield* prepareSafeDirectory(
      lexicalDirectory,
      canonicalDirectory,
      sourcePath,
      access,
      fs,
      path,
    );
    if (Option.isNone(directory)) return Option.none();
  }

  const file = path.join(lexicalDirectory, name);
  if (yield* fs.exists(file)) {
    const canonicalFile = yield* fs.realPath(file);
    if (!samePath(path, canonicalFile, path.join(canonicalDirectory, name))) {
      return yield* new StatePathRejected({ path: sourcePath });
    }
  }
  return Option.some(file);
});

/** A write creates missing directories, so absence here is an internal invariant violation. */
const prepareSafeSidecarFile = Effect.fn("SidecarStore.prepareFile")(function* (
  repoRoot: string,
  sourcePath: string,
  relativeFile: string,
  fs: FileSystem.FileSystem,
  path: Path.Path,
): Effect.fn.Return<string, StatePathRejected | PlatformError> {
  const selected = yield* safeSidecarFile(repoRoot, sourcePath, relativeFile, "write", fs, path);
  return Option.isSome(selected)
    ? selected.value
    : yield* Effect.die(new Error("Sidecar write preparation returned no path."));
});

const prepareSafeDirectory = Effect.fn("SidecarStore.prepareSafeDirectory")(function* (
  lexical: string,
  canonical: string,
  sourcePath: string,
  access: SidecarAccess,
  fs: FileSystem.FileSystem,
  path: Path.Path,
): Effect.fn.Return<Option.Option<string>, StatePathRejected | PlatformError> {
  if (!(yield* fs.exists(lexical))) {
    if (access === "read") return Option.none();
    yield* fs
      .makeDirectory(lexical)
      .pipe(Effect.catch((cause) => (cause.reason._tag === "AlreadyExists" ? Effect.void : cause)));
  }
  const resolved = yield* fs.realPath(lexical);
  const info = yield* fs.stat(lexical);
  return samePath(path, resolved, canonical) && info.type === "Directory"
    ? Option.some(lexical)
    : yield* new StatePathRejected({ path: sourcePath });
});

function samePath(path: Path.Path, left: string, right: string): boolean {
  return path.relative(left, right) === "";
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
