/** `balade check`: read flags, run the typed check Effect, print the report. */

import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { formatJson, formatText, stdoutTheme, writeStderr, writeStdout } from "../../terminal.js";
import { runCheck } from "../../walkthrough/checker.js";
import { skillStalenessHints } from "./skill.js";

const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Emit the report as JSON"));

const files = Argument.variadic(
  Argument.string("file").pipe(
    Argument.withDescription("Walkthrough file; omit to use every discovered walkthrough"),
  ),
);

export const checkCommand = Command.make("check", { files, json: jsonFlag }, (config) =>
  Effect.gen(function* () {
    const outcome = yield* runCheck({ cwd: process.cwd(), paths: config.files });
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
