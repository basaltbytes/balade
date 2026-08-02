/**
 * Review state on disk (#14): one JSON file per walkthrough under `.balade/`
 * at the repository root, named after the walkthrough file
 * (`pr-96-loan-refactor.md` → `pr-96-loan-refactor.review.json`).
 *
 * The directory is excluded through `.git/info/exclude` rather than the
 * committed `.gitignore`, so a reviewer's marks never touch the repository.
 * A missing or mismatched file is legitimate absence. Unreadable, corrupt and
 * unwritable state stays in the typed error channel for the server boundary to
 * report or log deliberately.
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Effect, Option, Schema } from "effect";
import { parseReviewJson } from "../payload/parse-review.js";
import type { ReviewState } from "../payload/types.js";

const STATE_DIR = ".balade";

/** The exclude line, with the trailing slash git wants for a directory. */
const EXCLUDE_LINE = `${STATE_DIR}/`;

export interface ReviewStateStore {
  /** The stored state, or `None` when there is none this walkthrough can use. */
  read(sourcePath: string): Effect.Effect<Option.Option<ReviewState>, StateReadError>;
  write(sourcePath: string, state: ReviewState): Effect.Effect<void, StateWriteFailed>;
}

/** `walkthroughs/pr-96-loan-refactor.md` → `pr-96-loan-refactor.review.json`. */
export function stateFileName(sourcePath: string): string {
  const name = basename(sourcePath);
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

export function fileReviewStore(options: FileStoreOptions): ReviewStateStore {
  const dir = join(options.repoRoot, STATE_DIR);
  const fileFor = (sourcePath: string): string => join(dir, stateFileName(sourcePath));

  return {
    read(sourcePath) {
      const file = fileFor(sourcePath);
      return Effect.gen(function* () {
        const raw = yield* Effect.try({
          try: () => readFileSync(file, "utf8"),
          catch: (cause) => new StateReadFailed({ path: file, cause }),
        }).pipe(
          Effect.map(Option.some),
          Effect.catchTag("StateReadFailed", (error) =>
            isNotFound(error.cause) ? Effect.succeed(Option.none()) : error,
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
      });
    },

    write(sourcePath, state) {
      const file = fileFor(sourcePath);
      return Effect.try({
        try: () => {
          mkdirSync(dir, { recursive: true });
          writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
        },
        catch: (cause) => new StateWriteFailed({ path: file, cause }),
      }).pipe(
        Effect.andThen(
          excludeStateDir(options.repoRoot).pipe(
            Effect.catchTag("StateExcludeFailed", (error) =>
              Effect.logWarning(
                `balade: could not add .balade/ to ${error.path}; add it yourself to keep review state out of git.`,
                error,
              ),
            ),
          ),
        ),
      );
    },
  };
}

/**
 * Appends `.balade/` to `.git/info/exclude` when it is not already there. The
 * file belongs to the clone, not to the repository, so writing it commits the
 * reviewer to nothing.
 */
function excludeStateDir(repoRoot: string): Effect.Effect<void, StateExcludeFailed> {
  const info = join(repoRoot, ".git", "info");
  const file = join(info, "exclude");

  return Effect.gen(function* () {
    const current = yield* Effect.try({
      try: () => readFileSync(file, "utf8"),
      catch: (cause) => new StateExcludeFailed({ path: file, cause }),
    }).pipe(
      Effect.catchTag("StateExcludeFailed", (error) =>
        isNotFound(error.cause) ? Effect.succeed("") : error,
      ),
    );
    if (current.split("\n").some((line) => line.trim() === EXCLUDE_LINE)) return;

    const separator = current === "" || current.endsWith("\n") ? "" : "\n";
    yield* Effect.try({
      try: () => {
        mkdirSync(info, { recursive: true });
        appendFileSync(file, `${separator}${EXCLUDE_LINE}\n`, "utf8");
      },
      catch: (cause) => new StateExcludeFailed({ path: file, cause }),
    });
  });
}

const isNotFound = (cause: unknown): boolean =>
  cause instanceof Error && "code" in cause && cause.code === "ENOENT";
