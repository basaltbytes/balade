/**
 * Process adapter. Every git/gh call in the CLI goes through here, so the
 * rest of the resolver stays a pure function of the strings it returns.
 */

import { spawnSync } from "node:child_process";

export interface ExecResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

/* Diffs of large PRs and whole-file blobs pass through stdout. */
const MAX_BUFFER = 256 * 1024 * 1024;

const ENV = { ...process.env, GIT_PAGER: "cat", GIT_OPTIONAL_LOCKS: "0" };

export function exec(file: string, args: readonly string[], cwd: string): ExecResult {
  const res = spawnSync(file, [...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    env: ENV,
  });
  if (res.error !== undefined) {
    return { ok: false, stdout: "", stderr: res.error.message, code: -1 };
  }
  const code = res.status ?? -1;
  return { ok: code === 0, stdout: res.stdout ?? "", stderr: res.stderr ?? "", code };
}

function git(args: readonly string[], cwd: string): ExecResult {
  return exec("git", args, cwd);
}

export function gitOut(args: readonly string[], cwd: string): string | null {
  const res = git(args, cwd);
  return res.ok ? res.stdout : null;
}

export function gh(args: readonly string[], cwd: string): ExecResult {
  return exec("gh", args, cwd);
}

/** Absolute repository root holding `cwd`, or `null` outside any repository. */
export function gitToplevel(cwd: string): string | null {
  const out = gitOut(["rev-parse", "--show-toplevel"], cwd)?.trim();
  return out === undefined || out === "" ? null : out;
}
