/**
 * The pull request through git's eyes. A pull-request reference — a GitHub
 * URL, `#96`, or bare digits — names its walkthroughs instead of a path; a URL
 * also pins the `owner/name` the repository must match. Parsing is pure;
 * fetching `pull/<n>/head` and resolving the lightweight pull snapshot shell
 * out through the plumbing in `git/git.ts`.
 */

import { Effect, Option, Schema } from "effect";
import type { CommandFailed, NotARepository } from "../contract/context.js";
import { gitOut, gitToplevel } from "../shell.js";
import {
  makeResolvedPull,
  readPullRequest,
  repoSlug,
  resolveCommit,
  type PullRequest,
  type ResolvedPull,
} from "./git.js";
import { readPullIntentClaims, type PullIntentClaims } from "./intent.js";

export interface PrTarget {
  number: number;
  /** `owner/name` when the reference carries it (a URL), else `null`. */
  slug: string | null;
}

export type OpenTarget =
  | { kind: "files"; paths: readonly string[] }
  | { kind: "discovered" }
  | { kind: "pr"; pr: PrTarget }
  | { kind: "invalid"; message: string };

const PR_URL = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/;
const PR_SHORT = /^#?(\d+)$/;

/** A single argument read as a PR reference, or `null` when it is a path. */
export function parsePrTarget(argument: string): PrTarget | null {
  const url = PR_URL.exec(argument);
  if (url !== null && url[1] !== undefined && url[2] !== undefined && url[3] !== undefined) {
    return { number: Number(url[3]), slug: `${url[1]}/${url[2]}` };
  }
  const short = PR_SHORT.exec(argument);
  if (short !== null && short[1] !== undefined) {
    return { number: Number(short[1]), slug: null };
  }
  return null;
}

/** How `open` reads its positional arguments: paths, a PR reference, or nothing. */
export function parseOpenTarget(argv: readonly string[]): OpenTarget {
  if (argv.length === 0) return { kind: "discovered" };
  const references = argv.map(parsePrTarget).filter((target) => target !== null);
  if (references.length === 0) return { kind: "files", paths: argv };
  const first = references[0];
  if (argv.length > 1 || first === undefined) {
    return {
      kind: "invalid",
      message: "Serve one pull request at a time, on its own: `balade open <pr-url>`.",
    };
  }
  return { kind: "pr", pr: first };
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
      "Reading a pull request needs a GitHub origin and network access when its head is not checked out."
    );
  }
}

export type PullHeadError = NotARepository | CommandFailed | WrongRepository | PullFetchFailed;

export interface PullSnapshot extends ResolvedPull {
  readonly claims: PullIntentClaims;
}

export interface ResolvePullHeadOptions {
  readonly cwd: string;
  readonly target: PrTarget;
  readonly useGh?: boolean;
}

export const repositoryRootForTarget = Effect.fn("repositoryRootForTarget")(function* (
  cwd: string,
  target: PrTarget,
) {
  const root = yield* gitToplevel(cwd);
  const slug = yield* repoSlug(root);
  if (target.slug !== null && target.slug.toLowerCase() !== slug.toLowerCase()) {
    return yield* new WrongRepository({ wanted: target.slug, found: slug });
  }
  return root;
});

/** Fetch one advertised SHA without reading or writing process-global FETCH_HEAD. */
export const fetchPullHead = Effect.fn("fetchPullHead")(function* (root: string, number: number) {
  const advertised = yield* gitOut(
    ["ls-remote", "--refs", "origin", `refs/pull/${number}/head`],
    root,
  );
  const pin = advertised.trim().split(/\s/u)[0] ?? "";
  if (!/^[0-9a-f]{40,64}$/u.test(pin)) return yield* new PullFetchFailed({ number });
  yield* gitOut(["fetch", "--quiet", "--no-write-fetch-head", "origin", pin], root);
  const resolved = yield* resolveCommit(root, pin);
  if (Option.isNone(resolved) || resolved.value !== pin) {
    return yield* new PullFetchFailed({ number });
  }
  return pin;
});

/** Resolve the exact PR head and its lightweight metadata in one GitHub snapshot. */
export const resolvePullHead = Effect.fn("resolvePullHead")(function* (
  options: ResolvePullHeadOptions,
) {
  const root = yield* repositoryRootForTarget(options.cwd, options.target);
  const requested =
    options.useGh === false ? undefined : yield* readPullRequest(root, options.target.number);
  const pullOption = requested?.pull ?? Option.none<PullRequest>();
  const pull = Option.getOrUndefined(pullOption);
  const localHead = yield* resolveCommit(root, "HEAD");
  const pin =
    pull !== undefined && Option.isSome(localHead) && localHead.value === pull.headRefOid
      ? localHead.value
      : yield* fetchPullHead(root, options.target.number);
  const resolved = yield* makeResolvedPull({
    root,
    number: options.target.number,
    pin,
    requested,
    resolution: { _tag: "PullHead", head: pin },
  });
  const claims = yield* readPullIntentClaims({
    root: resolved.root,
    base: resolved.base,
    pin: resolved.pin,
    github: pullOption,
  });
  return {
    ...resolved,
    claims: claims.claims,
    notices: [...resolved.notices, ...claims.notices],
  } satisfies PullSnapshot;
});
