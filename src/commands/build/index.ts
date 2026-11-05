/** `balade build`: read flags, run the typed build Effect, print the outcome. */

import { Effect, Match, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import {
  printSoft,
  size,
  stdoutTheme,
  stopMessage,
  stopReports,
  writeStdout,
} from "../../terminal.js";
import {
  buildErrorMessage,
  exportContentsMessage,
  runBuild,
  type BuildOptions,
} from "./pipeline.js";

const langFlag = Flag.Literals("lang", ["en", "fr"]).pipe(
  Flag.withDescription("Chrome language; overrides meta.lang"),
  Flag.optional,
);

const outFlag = Flag.String("out").pipe(
  Flag.withDescription(
    "Where to write the export; defaults to <walkthrough>.<format> beside the file",
  ),
  Flag.optional,
);

/* Variadic so that "none" and "several" are answered by `build` itself — with
   the discovered paths (#21) — rather than by the argument parser. */
const buildFile = Argument.String("file").pipe(
  Argument.withDescription("The one walkthrough file to export"),
  Argument.variadic(),
);

export const buildCommand = Command.make(
  "build",
  {
    files: buildFile,
    lang: langFlag,
    out: outFlag,
    format: Flag.Literals("format", ["html", "json"]).pipe(Flag.withDefault("html")),
    base: Flag.String("base").pipe(
      Flag.withDescription(
        "Full base commit SHA; requires --head; skips gh and default-branch discovery",
      ),
      Flag.optional,
    ),
    head: Flag.String("head").pipe(
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
      const buildOptions: BuildOptions = {
        cwd: process.cwd(),
        paths: config.files,
        format: config.format,
      };
      if (Option.isSome(config.base) && Option.isSome(config.head)) {
        buildOptions.resolution = {
          _tag: "PullRange",
          base: config.base.value,
          head: config.head.value,
        };
      }
      if (Option.isSome(config.lang)) buildOptions.lang = config.lang.value;
      if (Option.isSome(config.out)) buildOptions.out = config.out.value;
      const result = yield* runBuild(buildOptions);
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
).pipe(Command.withDescription("Export one self-contained HTML review or a resolved JSON payload"));
