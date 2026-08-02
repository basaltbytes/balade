/**
 * Review state on disk (#14): one JSON file per walkthrough under `.balade/`
 * at the repository root, named after the walkthrough file
 * (`pr-96-loan-refactor.md` → `pr-96-loan-refactor.review.json`).
 *
 * The directory is excluded through `.git/info/exclude` rather than the
 * committed `.gitignore`, so a reviewer's marks never touch the repository.
 * Nothing here throws: a file that is missing, unreadable or corrupt reads as
 * "no state", and the reason goes to the warning seam.
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseReviewState } from "../payload/parse-review.js";
import type { ReviewState } from "../payload/types.js";

export const STATE_DIR = ".balade";

/** The exclude line, with the trailing slash git wants for a directory. */
const EXCLUDE_LINE = `${STATE_DIR}/`;

export interface ReviewStateStore {
  /** The stored state, or `null` when there is none this walkthrough can use. */
  read(sourcePath: string): ReviewState | null;
  write(sourcePath: string, state: ReviewState): void;
}

/** `walkthroughs/pr-96-loan-refactor.md` → `pr-96-loan-refactor.review.json`. */
export function stateFileName(sourcePath: string): string {
  const name = basename(sourcePath);
  const stem = name.endsWith(".md") ? name.slice(0, -".md".length) : name;
  return `${stem}.review.json`;
}

export interface FileStoreOptions {
  /** Repository root; the state directory is `<repoRoot>/.balade/`. */
  repoRoot: string;
  /** Where an unreadable state file is reported; it never stops a request. */
  warn: (message: string) => void;
}

export function fileReviewStore(options: FileStoreOptions): ReviewStateStore {
  const dir = join(options.repoRoot, STATE_DIR);
  const fileFor = (sourcePath: string): string => join(dir, stateFileName(sourcePath));

  return {
    read(sourcePath) {
      const file = fileFor(sourcePath);
      let raw: string;
      try {
        raw = readFileSync(file, "utf8");
      } catch {
        return null;
      }

      const stored = readState(raw);
      if (stored === null) {
        options.warn(`balade: ${file} is not a review-state file — its marks are ignored.`);
        return null;
      }
      /* Two walkthroughs of the same filename would share a state file name. The
         state names the walkthrough it belongs to, so the other one reads as absent
         instead of inheriting marks that were never made against it. */
      return stored.walkthrough === sourcePath ? stored : null;
    },

    write(sourcePath, state) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(fileFor(sourcePath), `${JSON.stringify(state, null, 2)}\n`, "utf8");
      excludeStateDir(options.repoRoot, options.warn);
    },
  };
}

function readState(raw: string): ReviewState | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  return parseReviewState(value);
}

/**
 * Appends `.balade/` to `.git/info/exclude` when it is not already there. The
 * file belongs to the clone, not to the repository, so writing it commits the
 * reviewer to nothing.
 */
function excludeStateDir(repoRoot: string, warn: (message: string) => void): void {
  const info = join(repoRoot, ".git", "info");
  const file = join(info, "exclude");

  let current = "";
  try {
    current = readFileSync(file, "utf8");
  } catch {
    /* A fresh clone may carry no exclude file; git reads the one written below. */
  }
  if (current.split("\n").some((line) => line.trim() === EXCLUDE_LINE)) return;

  const separator = current === "" || current.endsWith("\n") ? "" : "\n";
  try {
    mkdirSync(info, { recursive: true });
    appendFileSync(file, `${separator}${EXCLUDE_LINE}\n`, "utf8");
  } catch (error) {
    warn(
      `balade: could not add \`${EXCLUDE_LINE}\` to ${file} (${error instanceof Error ? error.message : String(error)}). ` +
        `Add it yourself to keep review state out of git.`,
    );
  }
}
