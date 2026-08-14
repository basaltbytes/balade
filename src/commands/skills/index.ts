/** `balade skills`: materialize the generated authoring skill into the host repository. */

import { Effect, Option } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { Command, Flag } from "effect/unstable/cli";
import { AUTHORING_PACKAGE_VERSION } from "../../authoring/package.js";
import type { CommandFailed, NotARepository } from "../../contract/context.js";
import { stdoutTheme, stopMessage, writeStdout } from "../../terminal.js";
import { runSkillsInstall, type SkillsInstallOptions } from "./install.js";

const out = Flag.string("out").pipe(
  Flag.withDescription(
    "Write <dir>/balade-authoring/SKILL.md instead of the conventional agent directories",
  ),
  Flag.optional,
);

const installCommand = Command.make("install", { out }, (config) =>
  Effect.gen(function* () {
    const installOptions: SkillsInstallOptions = { cwd: process.cwd() };
    if (Option.isSome(config.out)) installOptions.out = config.out.value;
    const written = yield* runSkillsInstall(installOptions);
    for (const file of written) writeStdout(`wrote ${stdoutTheme.emphasis(file)}\n`);
    writeStdout(
      `Installed the balade-authoring skill (authoring package ${AUTHORING_PACKAGE_VERSION}). Re-run after upgrading balade to refresh it.\n`,
    );
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        stopMessage(installErrorMessage(error));
      }),
    ),
  ),
).pipe(
  Command.withDescription(
    "Render the balade-authoring skill into .agents/skills/, plus .claude/skills/ when the repository uses Claude Code",
  ),
);

type InstallError = NotARepository | CommandFailed | PlatformError;

function installErrorMessage(error: InstallError): string {
  switch (error._tag) {
    case "NotARepository":
      return "Not inside a git repository — run balade skills install from the repository that should hold the skill, or pass --out <dir>.";
    case "CommandFailed":
      return `${error.file} ${error.args.join(" ")} failed (exit ${error.code}).`;
    default:
      return `Could not write the skill: ${error.message}`;
  }
}

export const skillsCommand = Command.make("skills").pipe(
  Command.withDescription("Manage the generated authoring skill for coding agents"),
  Command.withSubcommands([installCommand]),
);
