/** `balade skills`: materialize the generated authoring skill into the host repository. */

import { Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { AUTHORING_PACKAGE_VERSION } from "../../authoring/package.js";
import type { CommandFailed, NotARepository } from "../../contract/context.js";
import { stopMessage, writeStdout } from "../../terminal.js";
import { runSkillsInstall } from "./install.js";

const out = Flag.string("out").pipe(
  Flag.withDescription(
    "Write <dir>/balade-authoring/SKILL.md instead of the conventional agent directories",
  ),
  Flag.optional,
);

const installCommand = Command.make("install", { out }, (config) =>
  Effect.gen(function* () {
    const written = yield* runSkillsInstall({
      cwd: process.cwd(),
      ...(Option.isSome(config.out) ? { out: config.out.value } : {}),
    });
    for (const file of written) writeStdout(`wrote ${file}\n`);
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
    "Render the balade-authoring skill into .claude/skills/ and .agents/skills/",
  ),
);

type InstallError = NotARepository | CommandFailed | { readonly message: string };

function installErrorMessage(error: InstallError): string {
  if ("_tag" in error && error._tag === "NotARepository") {
    return "Not inside a git repository — run balade skills install from the repository that should hold the skill, or pass --out <dir>.";
  }
  if ("_tag" in error && error._tag === "CommandFailed") {
    return `${error.file} ${error.args.join(" ")} failed (exit ${error.code}).`;
  }
  return `Could not write the skill: ${error.message}`;
}

export const skillsCommand = Command.make("skills").pipe(
  Command.withDescription("Manage the generated authoring skill for coding agents"),
  Command.withSubcommands([installCommand]),
);
