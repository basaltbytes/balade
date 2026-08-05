/**
 * The resolved PR context: everything the compiler and the preset macros read
 * from git. Built by `resolve/git.ts`; a test or a future adapter can supply
 * any object with this shape.
 */

import type { Option } from "effect";
import type { FileEntry, Payload } from "./types.js";

export interface ResolveContext {
  /** Absolute path of the repository root. */
  repoRoot: string;
  /** `owner/name` when the remote is known, else the repository directory name. */
  repoSlug: string;
  /** Full SHA the walkthrough is stamped against. */
  pin: string;
  /** Full SHA of the diff base (PR base, else merge-base with the default branch). */
  baseSha: string;
  /** Full SHA of the current PR head. The branch names live on `pr.base` / `pr.head`. */
  headSha: string;
  /** Commits between the stamp and the head; > 0 shows the stale banner. */
  headDistance: number;
  /** Paths any commit in `stamp..head` touched. */
  touched: ReadonlySet<string>;
  pr: Payload["pr"];
  /** Every changed file of the PR at the pin, without author-supplied fields. */
  files: readonly FileEntry[];
  /** Change overlay per path: new-file line numbers the PR added or modified. */
  changed: ReadonlyMap<string, ReadonlySet<number>>;
  /** Source lines of a file at the pinned commit; `None` when it does not exist. */
  blob(path: string): Option.Option<readonly string[]>;
}
