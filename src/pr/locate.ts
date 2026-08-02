/**
 * Locating the walkthroughs a pull request names (spec #26, #27). Working tree
 * first — the branch may be checked out — then the PR's own ref: fetching
 * `pull/<n>/head` brings the artifact into the clone without touching the
 * checkout. Every failure mode is a typed error the CLI turns into a note.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Context, Effect, Layer, Schema } from "effect";
import {
  discoverWalkthroughs,
  discoverWalkthroughsAt,
  NOT_A_REPO,
  walkthroughPr,
} from "../check/discover.js";
import { gitOut, gitToplevel } from "../resolve/exec.js";
import { repoSlug } from "../resolve/git.js";
import type { PrTarget } from "./target.js";

export class NotARepository extends Schema.TaggedErrorClass<NotARepository>()(
  "NotARepository",
  {},
) {
  get note(): string {
    return NOT_A_REPO;
  }
}

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

export type LocateError = NotARepository | WrongRepository | PullFetchFailed | NoWalkthroughForPull;

export interface Located {
  /** Absolute repository root. */
  root: string;
  /** Repo-relative walkthrough paths naming the PR, sorted. */
  paths: readonly string[];
  /** The commit the sources are read at; absent when the working tree holds them. */
  at?: string;
}

export class PrLocator extends Context.Service<
  PrLocator,
  {
    readonly locate: (cwd: string, target: PrTarget) => Effect.Effect<Located, LocateError>;
  }
>()("balade/PrLocator") {
  static readonly layer = Layer.sync(PrLocator, () => ({
    locate: Effect.fn("PrLocator.locate")(function* (cwd: string, target: PrTarget) {
      const root = gitToplevel(cwd);
      if (root === null) return yield* new NotARepository({});

      const slug = repoSlug(root);
      if (target.slug !== null && target.slug.toLowerCase() !== slug.toLowerCase()) {
        return yield* new WrongRepository({ wanted: target.slug, found: slug });
      }

      const checkedOut = naming(target.number, discoverWalkthroughs(cwd).paths, (path) =>
        read(join(root, path)),
      );
      if (checkedOut.length > 0) return { root, paths: checkedOut };

      const at = fetchPullHead(root, target.number);
      if (at === null) return yield* new PullFetchFailed({ number: target.number });

      const held = naming(target.number, discoverWalkthroughsAt(root, at), (path) =>
        gitOut(["show", `${at}:${path}`], root),
      );
      if (held.length === 0) return yield* new NoWalkthroughForPull({ number: target.number });
      return { root, paths: held, at };
    }),
  }));
}

/** The walkthroughs whose frontmatter names this PR number. */
const naming = (
  number: number,
  paths: readonly string[],
  sourceOf: (path: string) => string | null,
): string[] =>
  paths.filter((path) => {
    const source = sourceOf(path);
    return source !== null && walkthroughPr(source) === number;
  });

/** GitHub advertises every PR head as `pull/<n>/head`; the SHA lands in FETCH_HEAD. */
const fetchPullHead = (root: string, number: number): string | null => {
  if (gitOut(["fetch", "--quiet", "origin", `pull/${number}/head`], root) === null) return null;
  return gitOut(["rev-parse", "FETCH_HEAD"], root)?.trim() ?? null;
};

const read = (absolute: string): string | null => {
  try {
    return readFileSync(absolute, "utf8");
  } catch {
    return null;
  }
};
