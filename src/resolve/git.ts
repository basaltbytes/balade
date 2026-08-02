/**
 * Git-first, gh-optional resolution. Blobs, diffs and the merge-base need only
 * git, so `check` runs in CI with `fetch-depth: 0` and no gh auth; gh only
 * enriches the PR header when it is there and authenticated.
 */

import { Effect, Option, Schema } from "effect";
import { basename, win32 } from "node:path";
import type { CheckDiagnostic, FileEntry, FileStatus, Payload } from "../payload/types.js";
import type { ResolveContext } from "../resolve/context.js";
import { changedLines, splitDiff } from "./diff.js";
import { gh, gitOut, gitToplevel, type CommandFailed, type NotARepository } from "./exec.js";
import { sha256 } from "./hash.js";
import { langOf } from "./lang.js";

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
  /** Fetched commit served without a checkout; tried as the head before local fallbacks. */
  at?: string;
  /** `false` skips gh entirely — CI without auth, and the test fixtures. */
  useGh?: boolean;
}

export interface ResolveResult {
  ctx: ResolveContext;
  diagnostics: CheckDiagnostic[];
}

export class CommitUnresolvable extends Schema.TaggedErrorClass<CommitUnresolvable>()(
  "CommitUnresolvable",
  { commit: Schema.String, file: Schema.String },
) {}

export type ResolveError = NotARepository | CommandFailed | CommitUnresolvable;

/** What the resolver keeps of `gh pr view`, once every field has been checked. */
interface PullRequest {
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
  readonly diagnostics: readonly CheckDiagnostic[];
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
});

const decodePullRequest = Schema.decodeUnknownEffect(PullRequestResponse, {
  onExcessProperty: "error",
});

export const resolveContext = Effect.fn("resolveContext")(function* (options: ResolveOptions) {
  const diagnostics: CheckDiagnostic[] = [];
  const root = yield* gitToplevel(options.cwd);

  const pinProbe = yield* resolveCommit(root, options.commit);
  if (Option.isNone(pinProbe))
    return yield* new CommitUnresolvable({ commit: options.commit, file: options.file });
  const pin = pinProbe.value;

  /* Lazy: when gh supplied both base fields, the probes never run. */
  let probedDefault: string | undefined;
  const defaultBranch = Effect.suspend(() =>
    probedDefault === undefined
      ? findDefaultBranch(root).pipe(
          Effect.tap((branch) => Effect.sync(() => (probedDefault = branch))),
        )
      : Effect.succeed(probedDefault),
  );
  const requested =
    options.useGh === false ? undefined : yield* readPullRequest(root, options.pr, options.file);
  if (requested !== undefined) diagnostics.push(...requested.diagnostics);
  const pull =
    requested !== undefined && Option.isSome(requested.pull) ? requested.pull.value : undefined;

  const headOption = yield* firstSha(root, [
    pull?.headRefOid,
    options.at,
    pull?.headRefName,
    "HEAD",
  ]);
  const head = Option.getOrElse(headOption, () => pin);
  const directBase = yield* firstSha(root, [pull?.baseRefOid]);
  const base = Option.isSome(directBase)
    ? directBase.value
    : yield* Effect.gen(function* () {
        const branch = yield* defaultBranch;
        const merged = yield* mergeBase(root, branch, pin);
        if (Option.isSome(merged)) return merged.value;
        const parent = yield* parentOf(root, pin);
        return Option.getOrElse(parent, () => pin);
      });

  const entries = yield* readFiles(root, base, pin);
  const changed = yield* readOverlay(root, base, pin);
  const headDistance = Number(
    (yield* gitOut(["rev-list", "--count", `${pin}..${head}`], root)).trim(),
  );
  const touched = new Set(
    (yield* gitOut(["log", "--format=", "--name-only", `${pin}..${head}`], root))
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

  const stats = entries.reduce(
    (acc, entry) => ({
      files: acc.files + 1,
      additions: acc.additions + entry.additions,
      deletions: acc.deletions + entry.deletions,
    }),
    { files: 0, additions: 0, deletions: 0 },
  );

  const slug = yield* repoSlug(root);
  const pr: Payload["pr"] = {
    number: options.pr,
    url: pull?.url ?? `https://github.com/${slug}/pull/${options.pr}`,
    author:
      pull?.author ??
      ((yield* gitOut(["log", "-1", "--format=%an", pin], root)).trim() || "unknown"),
    state: prState(pull?.state),
    base: pull?.baseRefName ?? (yield* defaultBranch),
    head: pull?.headRefName ?? Option.getOrElse(yield* symbolicHead(root), () => "HEAD"),
    commits:
      pull?.commits ??
      Number((yield* gitOut(["rev-list", "--count", `${base}..${head}`], root)).trim()),
    stats,
  };

  const ctx: ResolveContext = {
    repoRoot: root,
    repoSlug: slug,
    pin,
    baseSha: base,
    headSha: head,
    headDistance: Number.isFinite(headDistance) ? headDistance : 0,
    touched,
    pr,
    files: entries,
    changed,
    blob,
  };
  return { ctx, diagnostics };
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
    gitOut(["rev-parse", "--verify", "--quiet", `${revision}^{commit}`], root),
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
const readPullRequest = (root: string, number: number, file: string) =>
  gh(
    [
      "pr",
      "view",
      String(number),
      "--json",
      "url,state,author,baseRefName,headRefName,baseRefOid,headRefOid,commits",
    ],
    root,
  ).pipe(
    Effect.matchEffect({
      onFailure: (error) =>
        Effect.succeed<PullRequestResult>({
          pull: Option.none(),
          diagnostics: [ghWarning(file, `exit ${error.code}: ${firstLine(error.stderr)}`)],
        }),
      onSuccess: (stdout) =>
        Effect.try({
          try: () => JSON.parse(stdout) as unknown,
          catch: () => ghWarning(file, "its answer was not JSON"),
        }).pipe(
          Effect.flatMap((body) =>
            decodePullRequest(body).pipe(
              Effect.mapError(() =>
                ghWarning(file, "its answer did not match the requested fields"),
              ),
            ),
          ),
          Effect.match({
            onFailure: (diagnostic): PullRequestResult => ({
              pull: Option.none(),
              diagnostics: [diagnostic],
            }),
            onSuccess: (response): PullRequestResult => ({
              pull: Option.some({
                url: response.url,
                state: response.state,
                author: response.author?.login,
                baseRefName: response.baseRefName,
                headRefName: response.headRefName,
                baseRefOid: response.baseRefOid,
                headRefOid: response.headRefOid,
                commits: response.commits.length,
              }),
              diagnostics: [],
            }),
          }),
        ),
    }),
  );

function ghWarning(file: string, detail: string): CheckDiagnostic {
  return {
    code: "gh-unavailable",
    level: "warning",
    file,
    message: `gh unavailable — PR header uses git fallbacks (${detail}).`,
    hint: "Install gh and run `gh auth login` to fill the author, state, base branch and commit count; git alone resolves every range.",
  };
}

function firstLine(stderr: string): string {
  return (
    stderr
      .split("\n")
      .find((line) => line.trim() !== "")
      ?.trim() ?? "no output"
  );
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

const readFiles = Effect.fn("readFiles")(function* (root: string, base: string, pin: string) {
  const nameStatus = parseNameStatus(
    yield* gitOut(["diff", "-M", "--name-status", "-z", base, pin], root),
  );
  const numStat = parseNumStat(yield* gitOut(["diff", "-M", "--numstat", "-z", base, pin], root));
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
  for (const record of nameStatus) {
    const stat = numStat.get(record.path) ?? { additions: 0, deletions: 0, binary: false };
    const diff = diffs.get(record.path);
    const oldPath = record.oldPath ?? diff?.oldPath ?? undefined;
    const binary = stat.binary || diff?.binary === true;
    const oldContent = record.status === "A" ? null : yield* content(base, oldPath ?? record.path);
    const newContent = record.status === "D" ? null : yield* content(pin, record.path);
    entries.push({
      path: record.path,
      status: record.status,
      additions: stat.additions,
      deletions: stat.deletions,
      hash: yield* entryHash(root, pin, record.path, diff?.body ?? ""),
      lang: langOf(record.path),
      diff: binary
        ? null
        : {
            unified: diff?.body ?? "",
            oldContent,
            newContent,
          },
      ...(oldPath !== undefined && record.status === "R" ? { oldPath } : {}),
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
