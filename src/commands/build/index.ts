/** `balade build`: read flags, run the typed build Effect, print the outcome. */

import { Effect, Match, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import {
  printSoft,
  size,
  stdoutTheme,
  stopMessage,
  stopReports,
  writeStdout,
} from "../../terminal.js";
import { buildErrorMessage, exportContentsMessage, runBuild } from "./pipeline.js";

const langFlag = Flag.choice("lang", ["en", "fr"]).pipe(
  Flag.withDescription("Chrome language; overrides meta.lang"),
  Flag.optional,
);

const outFlag = Flag.string("out").pipe(
  Flag.withDescription("Where to write the HTML; defaults to <walkthrough>.html beside the file"),
  Flag.optional,
);

/* Variadic so that "none" and "several" are answered by `build` itself — with
   the discovered paths (#21) — rather than by the argument parser. */
const buildFile = Argument.variadic(
  Argument.string("file").pipe(Argument.withDescription("The one walkthrough file to export")),
);

export const buildCommand = Command.make(
  "build",
  { files: buildFile, lang: langFlag, out: outFlag },
  (config) =>
    Effect.gen(function* () {
      const result = yield* runBuild({
        cwd: process.cwd(),
        paths: config.files,
        ...(Option.isSome(config.lang) ? { lang: config.lang.value } : {}),
        ...(Option.isSome(config.out) ? { out: config.out.value } : {}),
      });
      return yield* Match.valueTags(result, {
        Built: ({ reports, file, bytes, changedFileCount }) =>
          Effect.sync(() => {
            printSoft(reports);
            writeStdout(
              `balade wrote ${stdoutTheme.emphasis(file)} (${size(bytes)})\n` +
                `${exportContentsMessage(changedFileCount)}\n`,
            );
          }),
        BuildNotRun: ({ message }) => Effect.sync(() => stopMessage(message)),
        BuildFailed: ({ reports }) => Effect.sync(() => stopReports(reports)),
      });
    }).pipe(Effect.catch((error) => Effect.sync(() => stopMessage(buildErrorMessage(error))))),
).pipe(
  Command.withDescription(
    "Export one self-contained HTML review; no server, state stays in the browser",
  ),
);
