/** Command layer that keeps real Git while replacing only the optional gh seam. */

import { Effect, Layer } from "effect";
import { CommandFailed } from "../../src/contract/context.js";
import { CommandExecutor, type CommandExecutorShape } from "../../src/shell.js";

type GhExecutor = (args: readonly string[], cwd: string) => Effect.Effect<string, CommandFailed>;

export function commandLayerWithGh(executeGh: GhExecutor) {
  return Layer.effect(
    CommandExecutor,
    Effect.gen(function* () {
      const live = yield* CommandExecutor;
      return {
        exec: Effect.fn("CommandExecutor.testGh")(function* (
          file: string,
          args: readonly string[],
          cwd: string,
        ) {
          if (file === "gh") return yield* executeGh(args, cwd);
          return yield* live.exec(file, args, cwd);
        }),
      } satisfies CommandExecutorShape;
    }),
  ).pipe(Layer.provide(CommandExecutor.layer));
}

export const unavailableGhLayer = commandLayerWithGh((args, cwd) =>
  Effect.fail(
    new CommandFailed({
      file: "gh",
      args,
      cwd,
      stderr: "gh unavailable in test",
      code: 1,
    }),
  ),
);
