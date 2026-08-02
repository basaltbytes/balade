/**
 * Process adapter. Every git/gh call in the CLI goes through here, so the
 * rest of the resolver stays a pure function of the strings it returns.
 */

import { spawnSync } from "node:child_process";
import { Effect, Schema } from "effect";

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

export type ExecError = CommandFailed | NotARepository;

/* Diffs of large PRs and whole-file blobs pass through stdout. */
const MAX_BUFFER = 256 * 1024 * 1024;

const ENV = {
  ...process.env,
  GIT_PAGER: "cat",
  GIT_OPTIONAL_LOCKS: "0",
  /* Git's stderr is part of the adapter's failure classification below. */
  LC_ALL: "C",
};

export const exec = Effect.fn("exec")(function* (
  file: string,
  args: readonly string[],
  cwd: string,
) {
  const res = spawnSync(file, [...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    env: ENV,
  });
  const code = res.status ?? -1;
  if (res.error !== undefined || code !== 0) {
    return yield* new CommandFailed({
      file,
      args,
      cwd,
      stderr: res.error?.message ?? res.stderr ?? "",
      code,
    });
  }
  return res.stdout ?? "";
});

export const gitOut = (args: readonly string[], cwd: string) => exec("git", args, cwd);

export const gh = (args: readonly string[], cwd: string) => exec("gh", args, cwd);

/** Absolute repository root holding `cwd`. */
export const gitToplevel = Effect.fn("gitToplevel")(function* (cwd: string) {
  const out = yield* gitOut(["rev-parse", "--show-toplevel"], cwd).pipe(
    Effect.catchTag(
      "CommandFailed",
      (error): Effect.Effect<never, ExecError> =>
        error.file === "git" && error.stderr.includes("not a git repository")
          ? Effect.fail(new NotARepository({ cwd }))
          : Effect.fail(error),
    ),
  );
  const root = out.trim();
  return root === "" ? yield* new NotARepository({ cwd }) : root;
});
