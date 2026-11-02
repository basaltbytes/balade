/** `balade check`: read flags, run the typed check Effect, print the report. */

import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import {
  formatJson,
  formatText,
  stdoutTheme,
  stopMessage,
  writeStderr,
  writeStdout,
} from "../../terminal.js";
import { runCheck, type CheckOptions } from "../../walkthrough/checker.js";
import { skillStalenessHints } from "./skill.js";

const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Emit the report as JSON"));

const files = Argument.variadic(
  Argument.string("file").pipe(
    Argument.withDescription("Walkthrough file; omit to use every discovered walkthrough"),
  ),
);

export const checkCommand = Command.make(
  "check",
  {
    files,
    json: jsonFlag,
    base: Flag.string("base").pipe(
      Flag.withDescription(
        "Full base commit SHA; requires --head; skips gh and default-branch discovery",
      ),
      Flag.optional,
    ),
    head: Flag.string("head").pipe(
      Flag.withDescription("Full PR head commit SHA; requires --base"),
      Flag.optional,
    ),
  },
  (config) =>
    Effect.gen(function* () {
      if (Option.isSome(config.base) !== Option.isSome(config.head)) {
        return yield* Effect.sync(() =>
          stopMessage("--base and --head must be supplied together."),
        );
      }
      const options: CheckOptions = { cwd: process.cwd(), paths: config.files };
      if (Option.isSome(config.base) && Option.isSome(config.head)) {
        options.resolution = {
          _tag: "PullRange",
          base: config.base.value,
          head: config.head.value,
        };
      }
      const outcome = yield* runCheck(options);
      const hints = yield* skillStalenessHints(process.cwd());
      yield* Effect.sync(() => {
        writeStdout(config.json ? `${formatJson(outcome)}\n` : formatText(outcome, stdoutTheme));
        /* Stderr keeps `--json` stdout parseable; the hint never fails the check. */
        for (const hint of hints) writeStderr(`${hint}\n`);
        if (outcome._tag === "CheckFailed") process.exitCode = 1;
      });
    }),
).pipe(
  Command.withDescription(
    "Validate walkthroughs: schema, git references, expect= and range echoes",
  ),
);
