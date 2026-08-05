/**
 * Balade-owned state on disk: the predictable `~/.balade` home directories,
 * and the review-state store (#14) — one JSON file per walkthrough under
 * `.balade/` at the repository root, named after the walkthrough file
 * (`pr-96-loan-refactor.md` → `pr-96-loan-refactor.review.json`).
 *
 * The state directory is excluded through `.git/info/exclude` rather than the
 * committed `.gitignore`, so a reviewer's marks never touch the repository.
 * A missing or mismatched file is legitimate absence. Unreadable, corrupt and
 * unwritable state stays in the typed error channel for the server boundary to
 * report or log deliberately.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { parseReviewJson } from "./contract/review-parser.js";
import type { ReviewState } from "./contract/types.js";

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

export interface ReviewStateStoreShape {
  /** The stored state, or `None` when there is none this walkthrough can use. */
  readonly read: (sourcePath: string) => Effect.Effect<Option.Option<ReviewState>, StateReadError>;
  readonly write: (sourcePath: string, state: ReviewState) => Effect.Effect<void, StateWriteFailed>;
}

export class ReviewStateStore extends Context.Service<ReviewStateStore, ReviewStateStoreShape>()(
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
  const name = sourcePath.slice(sourcePath.lastIndexOf("/") + 1);
  const stem = name.endsWith(".md") ? name.slice(0, -".md".length) : name;
  return `${stem}.review.json`;
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

export interface FileStoreOptions {
  /** Repository root; the state directory is `<repoRoot>/.balade/`. */
  repoRoot: string;
}

function makeReviewStateStore(
  options: FileStoreOptions,
  fs: FileSystem.FileSystem,
  path: Path.Path,
): ReviewStateStoreShape {
  const dir = path.join(options.repoRoot, STATE_DIR);
  const fileFor = (sourcePath: string): string => path.join(dir, stateFileName(sourcePath));

  return {
    read: Effect.fn("ReviewStateStore.read")(function* (sourcePath) {
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

      const stored = yield* parseReviewJson(raw.value).pipe(
        Effect.mapError((cause) => new StateInvalid({ path: file, cause })),
      );
      /* Two walkthroughs of the same filename would share a state file name. The
         state names the walkthrough it belongs to, so the other one reads as absent
         instead of inheriting marks that were never made against it. */
      return stored.walkthrough === sourcePath ? Option.some(stored) : Option.none();
    }),

    write: Effect.fn("ReviewStateStore.write")(function* (sourcePath, state) {
      const file = fileFor(sourcePath);
      yield* fs
        .makeDirectory(dir, { recursive: true })
        .pipe(Effect.mapError((cause) => new StateWriteFailed({ path: file, cause })));
      yield* fs
        .writeFileString(file, `${JSON.stringify(state, null, 2)}\n`)
        .pipe(Effect.mapError((cause) => new StateWriteFailed({ path: file, cause })));
      yield* excludeStateDir(fs, path, options.repoRoot).pipe(
        Effect.catchTag("StateExcludeFailed", (error) =>
          Effect.logWarning(
            `balade: could not add .balade/ to ${error.path}; add it yourself to keep review state out of git.`,
            error,
          ),
        ),
      );
    }),
  };
}

/**
 * Appends `.balade/` to `.git/info/exclude` when it is not already there. The
 * file belongs to the clone, not to the repository, so writing it commits the
 * reviewer to nothing.
 */
function excludeStateDir(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  repoRoot: string,
): Effect.Effect<void, StateExcludeFailed> {
  const info = path.join(repoRoot, ".git", "info");
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
