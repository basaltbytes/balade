/**
 * Git-first, gh-optional resolution. Blobs, diffs and the merge-base need only
 * git, so `check` runs in CI with `fetch-depth: 0` and no gh auth; gh only
 * enriches the PR header when it is there and authenticated.
 */

import type { CheckDiagnostic, FileEntry, FileStatus, Payload } from "../payload/types.js";
import type { ResolveContext } from "../resolve/context.js";
import { isRecord } from "../payload/parse-review.js";
import { changedLines, splitDiff } from "./diff.js";
import { gh, gitOut, gitToplevel } from "./exec.js";
import { fileName } from "./paths.js";
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
  /** `false` skips gh entirely — CI without auth, and the test fixtures. */
  useGh?: boolean;
}

export interface ResolveResult {
  ctx: ResolveContext | null;
  diagnostics: CheckDiagnostic[];
}

/** What the resolver keeps of `gh pr view`, once every field has been checked. */
interface PullRequest {
  url: string | undefined;
  state: string | undefined;
  author: string | undefined;
  baseRefName: string | undefined;
  headRefName: string | undefined;
  baseRefOid: string | undefined;
  headRefOid: string | undefined;
  commits: number | undefined;
}

interface PullRequestResult {
  pull: PullRequest | null;
  diagnostics: CheckDiagnostic[];
}

export function resolveContext(options: ResolveOptions): ResolveResult {
  const diagnostics: CheckDiagnostic[] = [];
  const root = gitToplevel(options.cwd);
  if (root === null) {
    diagnostics.push({
      code: "repo-unresolvable",
      level: "error",
      file: options.file,
      message: "This directory is not inside a git repository.",
      hint: "Run balade from the repository that holds the walkthrough.",
    });
    return { ctx: null, diagnostics };
  }

  const pin = gitOut(
    ["rev-parse", "--verify", "--quiet", `${options.commit}^{commit}`],
    root,
  )?.trim();
  if (pin === undefined || pin === "") {
    diagnostics.push({
      code: "commit-unresolvable",
      level: "error",
      file: options.file,
      message: `The stamped commit \`${options.commit}\` is not in this clone.`,
      hint: "Fetch the branch (CI needs `fetch-depth: 0`), or re-stamp the walkthrough against a commit you have.",
    });
    return { ctx: null, diagnostics };
  }

  /* Lazy: when gh supplied both base fields, the probes never run. */
  let probedDefault: string | undefined;
  const defaultBranch = (): string => (probedDefault ??= findDefaultBranch(root));
  const requested =
    options.useGh === false ? null : readPullRequest(root, options.pr, options.file);
  if (requested !== null) diagnostics.push(...requested.diagnostics);
  const pull = requested?.pull ?? null;

  const head = firstSha(root, [pull?.headRefOid, pull?.headRefName, "HEAD"]) ?? pin;
  const base =
    firstSha(root, [pull?.baseRefOid]) ??
    mergeBase(root, defaultBranch(), pin) ??
    parentOf(root, pin) ??
    pin;

  const entries = readFiles(root, base, pin);
  const changed = readOverlay(root, base, pin);
  const headDistance = Number(
    gitOut(["rev-list", "--count", `${pin}..${head}`], root)?.trim() ?? "0",
  );
  const touched = new Set(
    (gitOut(["log", "--format=", "--name-only", `${pin}..${head}`], root) ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== ""),
  );

  /* The PR files already carry their content at the pin; only other paths cost a `git show`. */
  const blobs = new Map<string, readonly string[] | null>();
  for (const entry of entries) {
    if (entry.diff !== null) {
      blobs.set(
        entry.path,
        entry.diff.newContent === null ? null : splitLines(entry.diff.newContent),
      );
    }
  }
  const blob = (path: string): readonly string[] | null => {
    const cached = blobs.get(path);
    if (cached !== undefined) return cached;
    const out = gitOut(["show", `${pin}:${path}`], root);
    const lines = out === null ? null : splitLines(out);
    blobs.set(path, lines);
    return lines;
  };

  const stats = entries.reduce(
    (acc, entry) => ({
      files: acc.files + 1,
      additions: acc.additions + entry.additions,
      deletions: acc.deletions + entry.deletions,
    }),
    { files: 0, additions: 0, deletions: 0 },
  );

  const slug = repoSlug(root);
  const pr: Payload["pr"] = {
    number: options.pr,
    url: pull?.url ?? `https://github.com/${slug}/pull/${options.pr}`,
    author: pull?.author ?? gitOut(["log", "-1", "--format=%an", pin], root)?.trim() ?? "unknown",
    state: prState(pull?.state),
    base: pull?.baseRefName ?? defaultBranch(),
    head:
      pull?.headRefName ?? gitOut(["rev-parse", "--abbrev-ref", "HEAD"], root)?.trim() ?? "HEAD",
    commits:
      pull?.commits ??
      Number(gitOut(["rev-list", "--count", `${base}..${head}`], root)?.trim() ?? "0"),
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
}

/* ------------------------------------------------------------------ */
/* git plumbing                                                        */
/* ------------------------------------------------------------------ */

function splitLines(content: string): string[] {
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function firstSha(root: string, candidates: readonly (string | undefined)[]): string | null {
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === "") continue;
    const sha = gitOut(["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`], root)?.trim();
    if (sha !== undefined && sha !== "") return sha;
  }
  return null;
}

function mergeBase(root: string, branch: string, pin: string): string | null {
  for (const ref of [`origin/${branch}`, branch]) {
    const out = gitOut(["merge-base", ref, pin], root)?.trim();
    if (out !== undefined && out !== "") return out;
  }
  return null;
}

function parentOf(root: string, pin: string): string | null {
  const out = gitOut(["rev-parse", "--verify", "--quiet", `${pin}^1^{commit}`], root)?.trim();
  return out === undefined || out === "" ? null : out;
}

function findDefaultBranch(root: string): string {
  const head = gitOut(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], root)?.trim();
  if (head !== undefined && head.startsWith("origin/")) return head.slice("origin/".length);
  for (const name of ["main", "master", "dev", "develop"]) {
    if (gitOut(["rev-parse", "--verify", "--quiet", `refs/heads/${name}`], root) !== null)
      return name;
    if (gitOut(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${name}`], root) !== null)
      return name;
  }
  return "main";
}

/** `owner/name` from the origin remote, else the repository directory name. */
export function repoSlug(root: string): string {
  const url = gitOut(["remote", "get-url", "origin"], root)?.trim();
  if (url !== undefined && url !== "") {
    const match = /[:/]([^/:]+\/[^/]+?)(?:\.git)?$/.exec(url);
    if (match?.[1] !== undefined) return match[1];
  }
  return fileName(root);
}

function prState(state: string | undefined): "open" | "closed" | "merged" {
  const value = (state ?? "").toLowerCase();
  return value === "merged" || value === "closed" ? value : "open";
}

/**
 * `gh pr view` enriches the header; git alone resolves everything else. A gh
 * that is missing, unauthenticated or offline is a warning the report carries,
 * never a silent downgrade of the PR header.
 */
function readPullRequest(root: string, number: number, file: string): PullRequestResult {
  const res = gh(
    [
      "pr",
      "view",
      String(number),
      "--json",
      "url,state,author,baseRefName,headRefName,baseRefOid,headRefOid,commits",
    ],
    root,
  );
  if (!res.ok)
    return {
      pull: null,
      diagnostics: [ghWarning(file, `exit ${res.code}: ${firstLine(res.stderr)}`)],
    };

  let body: unknown;
  try {
    body = JSON.parse(res.stdout);
  } catch {
    return { pull: null, diagnostics: [ghWarning(file, "its answer was not JSON")] };
  }
  if (!isRecord(body)) {
    return { pull: null, diagnostics: [ghWarning(file, "its answer was not a JSON object")] };
  }

  const author = body["author"];
  const commits = body["commits"];
  return {
    pull: {
      url: text(body["url"]),
      state: text(body["state"]),
      author: text(isRecord(author) ? author["login"] : undefined),
      baseRefName: text(body["baseRefName"]),
      headRefName: text(body["headRefName"]),
      baseRefOid: text(body["baseRefOid"]),
      headRefOid: text(body["headRefOid"]),
      commits: Array.isArray(commits) ? commits.length : undefined,
    },
    diagnostics: [],
  };
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

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
  for (let i = 0; i < parts.length; ) {
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
  for (let i = 0; i < parts.length; ) {
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

function readFiles(root: string, base: string, pin: string): FileEntry[] {
  const nameStatus = parseNameStatus(
    gitOut(["diff", "-M", "--name-status", "-z", base, pin], root) ?? "",
  );
  const numStat = parseNumStat(gitOut(["diff", "-M", "--numstat", "-z", base, pin], root) ?? "");
  const diffs = new Map(
    splitDiff(gitOut(["diff", "-M", "--unified=3", base, pin], root) ?? "").map((record) => [
      record.path,
      record,
    ]),
  );

  const contents = new Map<string, string | null>();
  const content = (sha: string, path: string): string | null => {
    const key = `${sha}:${path}`;
    const cached = contents.get(key);
    if (cached !== undefined) return cached;
    const out = gitOut(["show", `${sha}:${path}`], root);
    contents.set(key, out);
    return out;
  };

  return nameStatus.map((record): FileEntry => {
    const stat = numStat.get(record.path) ?? { additions: 0, deletions: 0, binary: false };
    const diff = diffs.get(record.path);
    const oldPath = record.oldPath ?? diff?.oldPath ?? undefined;
    const binary = stat.binary || diff?.binary === true;
    return {
      path: record.path,
      status: record.status,
      additions: stat.additions,
      deletions: stat.deletions,
      hash: entryHash(root, pin, record.path, diff?.body ?? ""),
      lang: langOf(record.path),
      diff: binary
        ? null
        : {
            unified: diff?.body ?? "",
            oldContent: record.status === "A" ? null : content(base, oldPath ?? record.path),
            newContent: record.status === "D" ? null : content(pin, record.path),
          },
      ...(oldPath !== undefined && record.status === "R" ? { oldPath } : {}),
    };
  });
}

/**
 * The review-state reset key. A pure rename and a binary change carry no diff
 * body, and hashing the empty string would give every one of them the same key:
 * the path plus the blob at the pin keeps them apart and moves when the bytes do.
 */
function entryHash(root: string, pin: string, path: string, body: string): string {
  if (body !== "") return sha256(body);
  const blob = gitOut(["rev-parse", `${pin}:${path}`], root)?.trim() ?? "";
  return sha256(`${path} ${blob}`);
}

function readOverlay(root: string, base: string, pin: string): Map<string, ReadonlySet<number>> {
  const overlay = new Map<string, ReadonlySet<number>>();
  for (const record of splitDiff(gitOut(["diff", "-M", "--unified=0", base, pin], root) ?? "")) {
    overlay.set(record.path, changedLines(record.body));
  }
  return overlay;
}
