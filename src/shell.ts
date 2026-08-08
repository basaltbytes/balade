/**
 * Process adapter. Every git/gh call in the CLI goes through here, so
 * resolution stays a pure function of the strings it returns.
 */

import { spawnSync } from "node:child_process";
import { Context, Effect, Layer, Path } from "effect";
import { CommandFailed, NotARepository } from "./contract/context.js";

type ExecError = CommandFailed | NotARepository;

/* Diffs of large PRs and whole-file blobs pass through stdout. */
const MAX_BUFFER = 256 * 1024 * 1024;

const ENV = {
  ...process.env,
  GIT_PAGER: "cat",
  GIT_OPTIONAL_LOCKS: "0",
  /* Git's stderr is part of the adapter's failure classification below. */
  LC_ALL: "C",
};

export interface CommandExecutorShape {
  readonly exec: (
    file: string,
    args: readonly string[],
    cwd: string,
  ) => Effect.Effect<string, CommandFailed>;
}

/** The one process port used by resolution. Swapping this layer changes how commands run. */
export class CommandExecutor extends Context.Service<CommandExecutor, CommandExecutorShape>()(
  "@balade/CommandExecutor",
) {
  static readonly layer = Layer.sync(CommandExecutor, () => {
    const exec = Effect.fn("CommandExecutor.exec")(function* (
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

    return { exec };
  });
}

export const exec = (file: string, args: readonly string[], cwd: string) =>
  CommandExecutor.use((executor) => executor.exec(file, args, cwd));

export const gitOut = (args: readonly string[], cwd: string) =>
  CommandExecutor.use((executor) => executor.exec("git", args, cwd));

export const gh = (args: readonly string[], cwd: string) =>
  CommandExecutor.use((executor) => executor.exec("gh", args, cwd));

export function firstLine(output: string): string {
  return (
    output
      .split("\n")
      .find((line) => line.trim() !== "")
      ?.trim() ?? "no output"
  );
}

/**
 * Absolute git common directory of the repository at `root` — where the
 * clone's shared `info/exclude` lives. In a linked worktree or a submodule
 * `<root>/.git` is a pointer file, so the directory is asked of git rather
 * than joined onto the root.
 */
export const gitCommonDir = Effect.fn("gitCommonDir")(function* (root: string) {
  const path = yield* Path.Path;
  const out = yield* gitOut(["rev-parse", "--git-common-dir"], root);
  /* Relative in a plain clone (`.git`), absolute in a linked worktree. */
  return path.resolve(root, out.trim());
});

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
