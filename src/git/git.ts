/**
 * Git-first, gh-optional resolution. Blobs, diffs and the merge-base need only
 * git, so `check` runs in CI with `fetch-depth: 0` and no gh auth; gh only
 * enriches the PR header when it is there and authenticated.
 */

import { Context, Effect, Layer, Match, Option, Result, Schema } from "effect";
import { basename, win32 } from "node:path";
import {
  CommitUnresolvable,
  ContextResolver,
  type CommandFailed,
  type PullResolution,
  type ResolveContext,
  type ResolveOptions,
} from "../contract/context.js";
import { sha256 } from "../contract/hash.js";
import { langOf } from "../contract/lang.js";
import type { CheckDiagnostic, FileEntry, FileStatus, Payload } from "../contract/types.js";
import { CommandExecutor, firstLine, gh, gitOut, gitToplevel } from "../shell.js";
import { changedLines, splitDiff } from "./diff.js";
import type { PullLinkedIssueReference, PullNotice, PullRequestClaimsSource } from "./intent.js";

export interface PullFile {
  readonly path: string;
  readonly status: FileStatus;
  readonly additions: number;
  readonly deletions: number;
  readonly binary: boolean;
  readonly oldPath?: string;
}

export interface ResolvedPull {
  readonly root: string;
  readonly repoSlug: string;
  readonly pin: string;
  readonly base: string;
  readonly head: string;
  readonly pull: Payload["pr"];
  readonly files: readonly PullFile[];
  readonly notices: readonly PullNotice[];
}

/** What the resolver keeps of `gh pr view`, once every field has been checked. */
export interface PullRequest extends PullRequestClaimsSource {
  readonly url: string;
  readonly state: string;
  readonly author: string | undefined;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly baseRefOid: string;
  readonly headRefOid: string;
  readonly commits: number;
}

interface PullRequestResult {
  readonly pull: Option.Option<PullRequest>;
  readonly notices: readonly PullNotice[];
}

const PullRequestResponse = Schema.Struct({
  url: Schema.NonEmptyString,
  state: Schema.NonEmptyString,
  author: Schema.NullOr(
    Schema.StructWithRest(Schema.Struct({ login: Schema.NonEmptyString }), [
      Schema.Record(Schema.String, Schema.Unknown),
    ]),
  ),
  baseRefName: Schema.NonEmptyString,
  headRefName: Schema.NonEmptyString,
  baseRefOid: Schema.NonEmptyString,
  headRefOid: Schema.NonEmptyString,
  commits: Schema.Array(Schema.Unknown),
  title: Schema.NonEmptyString,
  body: Schema.String,
  closingIssuesReferences: Schema.Array(
    Schema.StructWithRest(Schema.Struct({ url: Schema.NonEmptyString }), [
      Schema.Record(Schema.String, Schema.Unknown),
    ]),
  ),
});

const decodePullRequest = Schema.decodeUnknownEffect(PullRequestResponse, {
  onExcessProperty: "error",
});
const decodeRepositoryUrl = Schema.decodeUnknownResult(Schema.URLFromString);

class PullRepositoryUrlInvalid extends Schema.TaggedErrorClass<PullRepositoryUrlInvalid>()(
  "PullRepositoryUrlInvalid",
  { url: Schema.String, reason: Schema.String },
) {}

const resolveContext = Effect.fn("resolveContext")(function* (options: ResolveOptions) {
  const root = yield* gitToplevel(options.cwd);

  const pinProbe = yield* resolveCommit(root, options.commit);
  if (Option.isNone(pinProbe))
    return yield* new CommitUnresolvable({ commit: options.commit, file: options.file });
  const pin = pinProbe.value;
  const requested = options.useGh === false ? undefined : yield* readPullRequest(root, options.pr);
  const snapshot = yield* makeResolvedPull({
    root,
    number: options.pr,
    pin,
    requested,
    resolution: options.resolution,
  });
  const diagnostics = snapshot.notices.map(
    (notice): CheckDiagnostic => ({
      ...notice,
      level: "warning",
      file: options.file,
    }),
  );
  const entries = yield* hydrateFiles(snapshot);
  const changed = yield* readOverlay(root, snapshot.base, pin);
  const headDistance = Number(
    (yield* gitOut(["rev-list", "--count", `${pin}..${snapshot.head}`], root)).trim(),
  );
  const touched = new Set(
    (yield* gitOut(["log", "--format=", "--name-only", `${pin}..${snapshot.head}`], root))
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== ""),
  );
  /* The PR files already carry their content at the pin. Other referenced blobs
     are fetched before compilation, so the compiler's lookup remains pure. */
  const blobs = new Map<string, Option.Option<readonly string[]>>();
  for (const entry of entries) {
    if (entry.diff !== null) {
      blobs.set(
        entry.path,
        entry.diff.newContent === null
          ? Option.none()
          : Option.some(splitLines(entry.diff.newContent)),
      );
    }
  }
  const pending = [...new Set(options.references)].filter((path) => !blobs.has(path));
  if (pending.length > 0) {
    const held = new Set(
      (yield* gitOut(
        [
          "ls-tree",
          "-r",
          "--name-only",
          "-z",
          pin,
          "--",
          ...pending.map((path) => `:(literal)${path}`),
        ],
        root,
      ))
        .split("\0")
        .filter((path) => path !== ""),
    );
    for (const path of pending) {
      blobs.set(
        path,
        held.has(path)
          ? Option.some(splitLines(yield* gitOut(["show", `${pin}:${path}`], root)))
          : Option.none(),
      );
    }
  }
  const blob = (path: string): Option.Option<readonly string[]> => {
    return blobs.get(path) ?? Option.none();
  };

  const ctx: ResolveContext = {
    repoRoot: root,
    repoSlug: snapshot.repoSlug,
    pin,
    baseSha: snapshot.base,
    headSha: snapshot.head,
    headDistance: Number.isFinite(headDistance) ? headDistance : 0,
    touched,
    pr: snapshot.pull,
    files: entries,
    changed,
    blob,
  };
  return { ctx, diagnostics };
});

interface MakeResolvedPullOptions {
  readonly root: string;
  readonly number: number;
  readonly pin: string;
  readonly requested: PullRequestResult | undefined;
  readonly resolution: PullResolution | undefined;
}

export const makeResolvedPull = Effect.fn("makeResolvedPull")(function* (
  options: MakeResolvedPullOptions,
) {
  let probedDefault: string | undefined;
  const defaultBranch = Effect.suspend(() =>
    probedDefault === undefined
      ? findDefaultBranch(options.root).pipe(
          Effect.tap((branch) => Effect.sync(() => (probedDefault = branch))),
        )
      : Effect.succeed(probedDefault),
  );
  const pull =
    options.requested === undefined ? undefined : Option.getOrUndefined(options.requested.pull);
  const deriveRange = Effect.fn("derivePullRange")(function* (headCandidate: string | undefined) {
    const head = Option.getOrElse(
      yield* firstSha(options.root, [headCandidate, pull?.headRefOid, pull?.headRefName, "HEAD"]),
      () => options.pin,
    );
    const directBase = yield* firstSha(options.root, [pull?.baseRefOid]);
    if (Option.isSome(directBase)) return { base: directBase.value, head };
    const branch = yield* defaultBranch;
    const merged = yield* mergeBase(options.root, branch, options.pin);
    if (Option.isSome(merged)) return { base: merged.value, head };
    const parent = yield* parentOf(options.root, options.pin);
    return { base: Option.getOrElse(parent, () => options.pin), head };
  });
  const range = yield* options.resolution === undefined
    ? deriveRange(undefined)
    : Match.valueTags(options.resolution, {
        PullHead: ({ head }) => deriveRange(head),
        PullRange: (resolved) => Effect.succeed(resolved),
      });
  const { base, head } = range;
  const files = yield* readFileSummaries(options.root, base, options.pin);
  const stats = files.reduce(
    (acc, entry) => ({
      files: acc.files + 1,
      additions: acc.additions + entry.additions,
      deletions: acc.deletions + entry.deletions,
    }),
    { files: 0, additions: 0, deletions: 0 },
  );
  const slug = yield* repoSlug(options.root);
  const pr: Payload["pr"] = {
    number: options.number,
    url: pull?.url ?? `https://github.com/${slug}/pull/${options.number}`,
    author:
      pull?.author ??
      ((yield* gitOut(["log", "-1", "--format=%an", options.pin], options.root)).trim() ||
        "unknown"),
    state: prState(pull?.state),
    base: pull?.baseRefName ?? (yield* defaultBranch),
    head: pull?.headRefName ?? Option.getOrElse(yield* symbolicHead(options.root), () => "HEAD"),
    commits:
      pull?.commits ??
      Number((yield* gitOut(["rev-list", "--count", `${base}..${head}`], options.root)).trim()),
    stats,
  };
  return {
    root: options.root,
    repoSlug: slug,
    pin: options.pin,
    base,
    head,
    pull: pr,
    files,
    notices: options.requested?.notices ?? [],
  } satisfies ResolvedPull;
});

/* ------------------------------------------------------------------ */
/* git plumbing                                                        */
/* ------------------------------------------------------------------ */

function splitLines(content: string): string[] {
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

const firstSha = Effect.fn("firstSha")(function* (
  root: string,
  candidates: readonly (string | undefined)[],
) {
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === "") continue;
    const probe = yield* resolveCommit(root, candidate);
    if (Option.isSome(probe)) return probe;
  }
  return Option.none<string>();
});

const mergeBase = Effect.fn("mergeBase")(function* (root: string, branch: string, pin: string) {
  for (const ref of [`origin/${branch}`, branch]) {
    const resolved = yield* resolveCommit(root, ref);
    if (Option.isNone(resolved)) continue;
    const probe = yield* optionOnExitOne(gitOut(["merge-base", resolved.value, pin], root));
    if (Option.isSome(probe) && probe.value.trim() !== "") return Option.some(probe.value.trim());
  }
  return Option.none<string>();
});

const parentOf = (root: string, pin: string) => resolveCommit(root, `${pin}^1`);

const findDefaultBranch = Effect.fn("findDefaultBranch")(function* (root: string) {
  const head = yield* optionOnExitOne(
    gitOut(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], root),
  );
  if (Option.isSome(head) && head.value.trim().startsWith("origin/")) {
    return head.value.trim().slice("origin/".length);
  }
  for (const name of ["main", "master", "dev", "develop"]) {
    const local = yield* resolveCommit(root, `refs/heads/${name}`);
    if (Option.isSome(local)) return name;
    const remote = yield* resolveCommit(root, `refs/remotes/origin/${name}`);
    if (Option.isSome(remote)) return name;
  }
  return "main";
});

/**
 * `owner/name` from the origin remote, else the repository directory name.
 * The fallback accepts both POSIX and Windows absolute paths.
 */
export const repoSlug = Effect.fn("repoSlug")(function* (root: string) {
  const remote = yield* optionOnExitOne(gitOut(["config", "--get", "remote.origin.url"], root));
  if (Option.isSome(remote) && remote.value.trim() !== "") {
    const url = remote.value.trim();
    const match = /[:/]([^/:]+\/[^/]+?)(?:\.git)?$/.exec(url);
    if (match?.[1] !== undefined) return match[1];
  }
  return repoName(root);
});

/** Repository directory name for POSIX and Windows absolute paths. */
export const repoName = (root: string): string =>
  win32.isAbsolute(root) ? win32.basename(root) : basename(root);

/** A commit-ish resolved by a quiet probe; only git's documented exit 1 is absence. */
export const resolveCommit = Effect.fn("resolveCommit")(function* (root: string, revision: string) {
  const out = yield* optionOnExitOne(
    gitOut(["rev-parse", "--verify", "--quiet", "--end-of-options", `${revision}^{commit}`], root),
  );
  return Option.flatMap(out, (value) => {
    const sha = value.trim();
    return sha === "" ? Option.none() : Option.some(sha);
  });
});

const resolveObject = Effect.fn("resolveObject")(function* (root: string, revision: string) {
  const out = yield* optionOnExitOne(gitOut(["rev-parse", "--verify", "--quiet", revision], root));
  return Option.flatMap(out, (value) => {
    const oid = value.trim();
    return oid === "" ? Option.none() : Option.some(oid);
  });
});

const symbolicHead = (root: string) =>
  optionOnExitOne(gitOut(["symbolic-ref", "--quiet", "--short", "HEAD"], root)).pipe(
    Effect.map(Option.map((out) => out.trim())),
  );

const optionOnExitOne = <A, R>(
  effect: Effect.Effect<A, CommandFailed, R>,
): Effect.Effect<Option.Option<A>, CommandFailed, R> =>
  effect.pipe(
    Effect.map(Option.some),
    Effect.catchTag(
      "CommandFailed",
      (error): Effect.Effect<Option.Option<A>, CommandFailed> =>
        error.code === 1 ? Effect.succeed(Option.none<A>()) : Effect.fail(error),
    ),
  );

function prState(state: string | undefined): "open" | "closed" | "merged" {
  const value = (state ?? "").toLowerCase();
  return value === "merged" || value === "closed" ? value : "open";
}

/**
 * `gh pr view` enriches the header; git alone resolves everything else. A gh
 * that is missing, unauthenticated or offline is a warning the report carries,
 * never a silent downgrade of the PR header.
 */
export const readPullRequest = Effect.fn("readPullRequest")((root: string, number: number) =>
  gh(
    [
      "pr",
      "view",
      String(number),
      "--json",
      "url,state,author,baseRefName,headRefName,baseRefOid,headRefOid,commits,title,body,closingIssuesReferences",
    ],
    root,
  ).pipe(
    Effect.matchEffect({
      onFailure: (error) =>
        Effect.succeed<PullRequestResult>({
          pull: Option.none(),
          notices: [ghNotice(`exit ${error.code}: ${firstLine(error.stderr)}`)],
        }),
      onSuccess: (stdout) =>
        Effect.try({
          /* SAFETY: JSON.parse returns `any`; the assertion only forgets it down to `unknown`. */
          try: () => JSON.parse(stdout) as unknown,
          catch: () => ghNotice("its answer was not JSON"),
        }).pipe(
          Effect.flatMap((body) =>
            decodePullRequest(body).pipe(
              Effect.flatMap((response) => Effect.fromResult(pullRequestFromResponse(response))),
              Effect.mapError(() => ghNotice("its answer did not match the requested fields")),
            ),
          ),
          Effect.match({
            onFailure: (notice): PullRequestResult => ({
              pull: Option.none(),
              notices: [notice],
            }),
            onSuccess: (pull): PullRequestResult => ({
              pull: Option.some(pull),
              notices: [],
            }),
          }),
        ),
    }),
  ),
);

interface RepositoryLocation {
  readonly url: string;
  readonly host: string;
  readonly slug: string;
}

function pullRequestFromResponse(
  response: typeof PullRequestResponse.Type,
): Result.Result<PullRequest, PullRepositoryUrlInvalid> {
  return Result.all({
    pull: repositoryLocation(response.url),
    issues: Result.all(response.closingIssuesReferences.map(({ url }) => repositoryLocation(url))),
  }).pipe(
    Result.map(({ pull, issues }) => ({
      url: response.url,
      state: response.state,
      author: response.author?.login,
      baseRefName: response.baseRefName,
      headRefName: response.headRefName,
      baseRefOid: response.baseRefOid,
      headRefOid: response.headRefOid,
      commits: response.commits.length,
      title: response.title,
      body: response.body,
      linkedIssues: issues.map((issue) => linkedIssueReference(pull, issue)),
    })),
  );
}

function repositoryLocation(
  value: string,
): Result.Result<RepositoryLocation, PullRepositoryUrlInvalid> {
  return decodeRepositoryUrl(value).pipe(
    Result.mapError(
      () => new PullRepositoryUrlInvalid({ url: value, reason: "The value is not a URL." }),
    ),
    Result.flatMap((url) => {
      const [owner, repository] = url.pathname.split("/").filter((segment) => segment !== "");
      return owner === undefined || repository === undefined
        ? Result.fail(
            new PullRepositoryUrlInvalid({
              url: value,
              reason: "The URL does not identify a repository.",
            }),
          )
        : Result.succeed({ url: value, host: url.host, slug: `${owner}/${repository}` });
    }),
  );
}

function linkedIssueReference(
  pull: RepositoryLocation,
  issue: RepositoryLocation,
): PullLinkedIssueReference {
  if (
    pull.host.toLowerCase() === issue.host.toLowerCase() &&
    pull.slug.toLowerCase() === issue.slug.toLowerCase()
  ) {
    return { _tag: "SameRepositoryLinkedIssue", url: issue.url };
  }
  return {
    _tag: "ThirdPartyLinkedIssue",
    url: issue.url,
    repository: issue.slug,
  };
}

function ghNotice(detail: string): PullNotice {
  return {
    code: "gh-unavailable",
    message: `gh unavailable — PR header uses git fallbacks (${detail}).`,
    hint: "Install gh and run `gh auth login` to fill the PR header and author-stated intent; git alone resolves every range and commit subject.",
  };
}

/* ------------------------------------------------------------------ */
/* Changed files                                                       */
/* ------------------------------------------------------------------ */

interface NameStatus {
  status: FileStatus;
  path: string;
  oldPath?: string;
}

function parseNameStatus(out: string): NameStatus[] {
  const parts = out.split("\0").filter((part) => part !== "");
  const records: NameStatus[] = [];
  for (let i = 0; i < parts.length;) {
    const code = (parts[i] ?? "").trim();
    i++;
    const letter = code.charAt(0);
    if (letter === "R" || letter === "C") {
      const oldPath = parts[i] ?? "";
      const path = parts[i + 1] ?? "";
      i += 2;
      records.push({ status: letter === "R" ? "R" : "A", path, oldPath });
      continue;
    }
    const path = parts[i] ?? "";
    i++;
    records.push({ status: statusOf(letter), path });
  }
  return records;
}

function statusOf(letter: string): FileStatus {
  return letter === "A" || letter === "D" || letter === "R" ? letter : "M";
}

interface NumStat {
  additions: number;
  deletions: number;
  binary: boolean;
}

function parseNumStat(out: string): Map<string, NumStat> {
  const stats = new Map<string, NumStat>();
  const parts = out.split("\0").filter((part) => part !== "");
  for (let i = 0; i < parts.length;) {
    const record = parts[i] ?? "";
    i++;
    const fields = record.split("\t");
    const additions = fields[0] ?? "0";
    const deletions = fields[1] ?? "0";
    const inline = fields[2];
    const binary = additions === "-" || deletions === "-";
    const value: NumStat = {
      additions: binary ? 0 : Number(additions),
      deletions: binary ? 0 : Number(deletions),
      binary,
    };
    if (inline !== undefined && inline !== "") {
      stats.set(inline, value);
      continue;
    }
    /* Rename: the two paths follow as their own NUL-separated fields. */
    const path = parts[i + 1] ?? parts[i] ?? "";
    i += 2;
    stats.set(path, value);
  }
  return stats;
}

const readFileSummaries = Effect.fn("readFileSummaries")(function* (
  root: string,
  base: string,
  pin: string,
) {
  const nameStatus = parseNameStatus(
    yield* gitOut(["diff", "-M", "--name-status", "-z", base, pin], root),
  );
  const numStat = parseNumStat(yield* gitOut(["diff", "-M", "--numstat", "-z", base, pin], root));
  return nameStatus.map((record): PullFile => {
    const stat = numStat.get(record.path) ?? { additions: 0, deletions: 0, binary: false };
    const facets: OldPathFacet = {};
    if (record.oldPath !== undefined) facets.oldPath = record.oldPath;
    return {
      path: record.path,
      status: record.status,
      additions: stat.additions,
      deletions: stat.deletions,
      binary: stat.binary,
      ...facets,
    };
  });
});

type OldPathFacet = { oldPath?: string };

const hydrateFiles = Effect.fn("hydrateFiles")(function* (snapshot: ResolvedPull) {
  const { root, base, pin } = snapshot;
  const diffs = new Map(
    splitDiff(yield* gitOut(["diff", "-M", "--unified=3", base, pin], root)).map((record) => [
      record.path,
      record,
    ]),
  );

  const contents = new Map<string, string>();
  const content = (sha: string, path: string) => {
    const key = `${sha}:${path}`;
    const cached = contents.get(key);
    if (cached !== undefined) return Effect.succeed(cached);
    return gitOut(["show", `${sha}:${path}`], root).pipe(
      Effect.tap((out) => Effect.sync(() => contents.set(key, out))),
    );
  };

  const entries: FileEntry[] = [];
  for (const record of snapshot.files) {
    const diff = diffs.get(record.path);
    const oldPath = record.oldPath ?? diff?.oldPath ?? undefined;
    const binary = record.binary || diff?.binary === true;
    const oldContent = record.status === "A" ? null : yield* content(base, oldPath ?? record.path);
    const newContent = record.status === "D" ? null : yield* content(pin, record.path);
    const renameFacet: OldPathFacet = {};
    if (oldPath !== undefined && record.status === "R") renameFacet.oldPath = oldPath;
    entries.push({
      path: record.path,
      status: record.status,
      additions: record.additions,
      deletions: record.deletions,
      hash: yield* entryHash(root, pin, record.path, diff?.body ?? ""),
      lang: langOf(record.path),
      diff: binary
        ? null
        : {
            unified: diff?.body ?? "",
            oldContent,
            newContent,
          },
      ...renameFacet,
    });
  }
  return entries;
});

/**
 * The review-state reset key. A pure rename and a binary change carry no diff
 * body, and hashing the empty string would give every one of them the same key:
 * the path plus the blob at the pin keeps them apart and moves when the bytes do.
 */
const entryHash = (root: string, pin: string, path: string, body: string) => {
  if (body !== "") return Effect.succeed(sha256(body));
  return resolveObject(root, `${pin}:${path}`).pipe(
    Effect.map((probe) => sha256(`${path}\0${Option.getOrElse(probe, () => "")}`)),
  );
};

const readOverlay = Effect.fn("readOverlay")(function* (root: string, base: string, pin: string) {
  const overlay = new Map<string, ReadonlySet<number>>();
  const diff = yield* gitOut(["diff", "-M", "--unified=0", base, pin], root);
  for (const record of splitDiff(diff)) {
    overlay.set(record.path, changedLines(record.body));
  }
  return overlay;
});

/** The live resolution port: `resolveContext` behind the `ContextResolver` seam. */
export const contextResolverLive = Layer.effect(
  ContextResolver,
  Effect.gen(function* () {
    const dependencies = Context.pick(CommandExecutor)(yield* Effect.context<CommandExecutor>());
    return {
      resolve: Effect.fn("ContextResolver.resolve")((options: ResolveOptions) =>
        resolveContext(options).pipe(Effect.provide(dependencies)),
      ),
    };
  }),
);
