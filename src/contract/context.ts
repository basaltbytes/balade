/**
 * The resolution contract: everything the compiler and the preset macros read
 * from git, and the service that answers it. `git/git.ts` provides the live
 * resolver; a test or a future adapter can supply any object with this shape,
 * which is how `walkthrough/` compiles without ever importing `git/`.
 */

import { Context, Schema, type Effect, type Option } from "effect";
import type { CheckDiagnostic, FileEntry, Payload } from "./types.js";

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

/** How a pull request range is anchored when it is not derived from the checkout. */
export type PullResolution =
  | { readonly _tag: "PullHead"; readonly head: string }
  | { readonly _tag: "PullRange"; readonly base: string; readonly head: string };

/* The process-port failure vocabulary. Produced by `shell.ts`, carried across
   module boundaries by resolution and discovery, translated at the command
   boundaries that can explain them. */

export class CommandFailed extends Schema.TaggedErrorClass<CommandFailed>()("CommandFailed", {
  file: Schema.String,
  args: Schema.Array(Schema.String),
  cwd: Schema.String,
  stderr: Schema.String,
  code: Schema.Finite,
}) {}

export class NotARepository extends Schema.TaggedErrorClass<NotARepository>()("NotARepository", {
  cwd: Schema.String,
}) {
  get note(): string {
    return "Not inside a git repository — run balade from the repository that holds the walkthrough.";
  }
}

export class CommitUnresolvable extends Schema.TaggedErrorClass<CommitUnresolvable>()(
  "CommitUnresolvable",
  { commit: Schema.String, file: Schema.String },
) {}

export interface ResolveOptions {
  /** Any directory inside the repository. */
  cwd: string;
  pr: number;
  /** The stamped commit SHA from the frontmatter. */
  commit: string;
  /** Repo-relative path of the walkthrough file, for diagnostics. */
  file: string;
  /** Stamped blobs the pure compiler may inspect. */
  references: readonly string[];
  /** Fetched head or prepared range to rehydrate instead of using the current checkout. */
  resolution?: PullResolution;
  /** `false` skips gh entirely — CI without auth, and the test fixtures. */
  useGh?: boolean;
}

export interface ResolveResult {
  ctx: ResolveContext;
  diagnostics: CheckDiagnostic[];
}

export type ResolveError = NotARepository | CommandFailed | CommitUnresolvable;

export interface ContextResolverPort {
  readonly resolve: (options: ResolveOptions) => Effect.Effect<ResolveResult, ResolveError>;
}

/** The one resolution port the compiler pipeline reads a repository through. */
export class ContextResolver extends Context.Service<ContextResolver, ContextResolverPort>()(
  "@balade/ContextResolver",
) {}
