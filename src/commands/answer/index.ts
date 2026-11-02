/** `balade answer check`: local validation of an external agent's Markdoc body. */
import { Effect, FileSystem, Schema } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { checkAnswerEffect, type AnswerCheckError } from "../../walkthrough/answer.js";
import { loadErrorDiagnostic } from "../../walkthrough/pipeline.js";
import { stopMessage, writeStderr, writeStdout } from "../../terminal.js";

class AnswerFileReadFailed extends Schema.TaggedErrorClass<AnswerFileReadFailed>()(
  "AnswerFileReadFailed",
  { path: Schema.String, cause: Schema.Defect() },
) {}

function errorMessage(error: AnswerFileReadFailed | AnswerCheckError): string {
  return error._tag === "AnswerFileReadFailed"
    ? `Could not read answer file ${error.path}.`
    : loadErrorDiagnostic(error, "answer").message;
}

const checkCommand = Command.make(
  "check",
  {
    file: Argument.string("answer.md"),
    walkthrough: Flag.string("walkthrough").pipe(
      Flag.withDescription("Walkthrough file carrying the pinned commit and preset"),
    ),
    base: Flag.string("base").pipe(Flag.withDescription("Full base commit SHA")),
    head: Flag.string("head").pipe(Flag.withDescription("Full PR head commit SHA")),
    format: Flag.choice("format", ["text", "json"]).pipe(Flag.withDefault("text")),
  },
  (config) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const body = yield* fs
        .readFileString(config.file)
        .pipe(Effect.mapError((cause) => new AnswerFileReadFailed({ path: config.file, cause })));
      const result = yield* checkAnswerEffect(body, {
        _tag: "Repository",
        repository: process.cwd(),
        file: config.walkthrough,
        base: config.base,
        head: config.head,
      });
      yield* Effect.sync(() => {
        if (config.format === "json") writeStdout(`${JSON.stringify(result, null, 2)}\n`);
        else if (result._tag === "Accepted") writeStdout("Clarification checked and accepted.\n");
        else writeStderr(`${result.diagnostics.join("\n")}\n`);
        if (result._tag === "Rejected") process.exitCode = 1;
      });
    }).pipe(Effect.catch((error) => Effect.sync(() => stopMessage(errorMessage(error))))),
).pipe(Command.withDescription("Validate a clarification answer without gh or model sign-in"));

export const answerCommand = Command.make("answer").pipe(
  Command.withDescription("Check clarification answers from your own agent"),
  Command.withSubcommands([checkCommand]),
);
