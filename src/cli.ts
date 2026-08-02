#!/usr/bin/env node
/** Command boundary: read flags, run the typed build/session Effects, translate
    their failures into terminal output, and keep diagnostics as report values. */

import { NodeRuntime } from "@effect/platform-node";
import { Effect, Match, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { buildErrorMessage, runBuild } from "./build/run.js";
import { formatJson, formatText } from "./check/report.js";
import { runCheck } from "./check/run.js";
import { cliLayer } from "./live.js";
import type { CheckReport } from "./payload/types.js";
import { locateErrorMessage, PrLocator } from "./pr/locate.js";
import { parseOpenTarget, type PrTarget } from "./pr/target.js";
import { findAppBundle, serve } from "./server/serve.js";
import { prepareSession, sessionErrorMessage, type Selection } from "./server/session.js";

const VERSION = "0.1.0";

const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Emit the report as JSON"));

const langFlag = Flag.choice("lang", ["en", "fr"]).pipe(
  Flag.withDescription("Chrome language; overrides meta.lang"),
  Flag.optional,
);

const portFlag = Flag.integer("port").pipe(
  Flag.withDescription("Port to listen on; 0 asks the system for a free one"),
  Flag.withDefault(0),
);

const outFlag = Flag.string("out").pipe(
  Flag.withDescription("Where to write the HTML; defaults to <walkthrough>.html beside the file"),
  Flag.optional,
);

const files = Argument.variadic(
  Argument.string("file").pipe(
    Argument.withDescription("Walkthrough file; omit to use every discovered walkthrough"),
  ),
);

/* Variadic so that "none" and "several" are answered by `build` itself — with
   the discovered paths (#21) — rather than by the argument parser. */
const buildFile = Argument.variadic(
  Argument.string("file").pipe(Argument.withDescription("The one walkthrough file to export")),
);

const check = Command.make("check", { files, json: jsonFlag }, (config) =>
  Effect.gen(function* () {
    const outcome = yield* runCheck({ cwd: process.cwd(), paths: config.files });
    yield* Effect.sync(() => {
      process.stdout.write(config.json ? `${formatJson(outcome)}\n` : formatText(outcome));
      if (outcome._tag === "CheckFailed") process.exitCode = 1;
    });
  }),
).pipe(
  Command.withDescription(
    "Validate walkthroughs: schema, git references, expect= and range echoes",
  ),
);

const openTargets = Argument.variadic(
  Argument.string("target").pipe(
    Argument.withDescription(
      "Walkthrough file or pull request (URL, #number); omit to use every discovered walkthrough",
    ),
  ),
);

/** A PR target answers a located selection; the command boundary prints typed failures. */
const locateSelection = Effect.fn("locateSelection")(function* (target: PrTarget) {
  const locator = yield* PrLocator;
  return yield* locator
    .locate(process.cwd(), target)
    .pipe(Effect.map((located): Selection => ({ kind: "located", ...located })));
});

const open = Command.make(
  "open",
  { files: openTargets, lang: langFlag, port: portFlag },
  (config) =>
    Effect.gen(function* () {
      const appDir = yield* findAppBundle().pipe(
        Effect.map(Option.some),
        Effect.catchTag("AppBundleMissing", (error) =>
          Effect.sync(() => {
            stopMessage(error.note);
            return Option.none<string>();
          }),
        ),
      );
      if (Option.isNone(appDir)) return;

      const target = parseOpenTarget(config.files);
      if (target.kind === "invalid") {
        stopMessage(target.message);
        return;
      }
      const selection =
        target.kind === "pr"
          ? yield* locateSelection(target.pr).pipe(
              Effect.map(Option.some),
              Effect.catch((error) =>
                Effect.sync(() => {
                  stopMessage(locateErrorMessage(error));
                  return Option.none<Selection>();
                }),
              ),
            )
          : Option.some<Selection>(target);
      if (Option.isNone(selection)) return;

      const prepared = yield* prepareSession({
        cwd: process.cwd(),
        selection: selection.value,
        ...(Option.isSome(config.lang) ? { lang: config.lang.value } : {}),
      }).pipe(
        Effect.map(Option.some),
        Effect.catch((error) =>
          Effect.sync(() => {
            stopMessage(sessionErrorMessage(error));
            return Option.none();
          }),
        ),
      );
      if (Option.isNone(prepared)) return;
      return yield* Match.valueTags(prepared.value, {
        SessionReady: ({ session }) =>
          Effect.gen(function* () {
            printSoft(session.reports);
            const url = yield* serve({ appDir: appDir.value, port: config.port, api: session.api });
            process.stdout.write(`balade is serving ${served(session.paths)} at ${url}\n`);
            return yield* Effect.never;
          }),
        SessionNotStarted: ({ message }) => Effect.sync(() => stopMessage(message)),
        SessionFailed: ({ reports }) => Effect.sync(() => stopReports(reports)),
      });
    }).pipe(Effect.scoped),
).pipe(Command.withDescription("Serve the interactive walkthrough app"));

/** The boundary echo is a `check` affordance for the author; `open` shows diagnostics. */
const diagnosticsOnly = (reports: readonly CheckReport[]): readonly CheckReport[] =>
  reports.map((report) => ({ ...report, ranges: [] }));

const stopReports = (reports: readonly CheckReport[]): void => {
  process.stdout.write(formatText({ reports: diagnosticsOnly(reports) }));
  process.exitCode = 1;
};

const stopMessage = (message: string): void => {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
};

/** Soft commands: what did not resolve is printed here and rides on as error cards. */
const printSoft = (reports: readonly CheckReport[]): void => {
  const diagnostics = diagnosticsOnly(reports);
  if (diagnostics.some((report) => report.diagnostics.length > 0)) {
    process.stdout.write(formatText({ reports: diagnostics }));
  }
};

const served = (paths: readonly string[]): string =>
  paths.length === 1 ? (paths[0] ?? "") : `${paths.length} walkthroughs`;

const build = Command.make("build", { files: buildFile, lang: langFlag, out: outFlag }, (config) =>
  Effect.gen(function* () {
    const result = yield* runBuild({
      cwd: process.cwd(),
      paths: config.files,
      ...(Option.isSome(config.lang) ? { lang: config.lang.value } : {}),
      ...(Option.isSome(config.out) ? { out: config.out.value } : {}),
    }).pipe(
      Effect.map(Option.some),
      Effect.catch((error) =>
        Effect.sync(() => {
          stopMessage(buildErrorMessage(error));
          return Option.none();
        }),
      ),
    );
    if (Option.isNone(result)) return;
    return yield* Match.valueTags(result.value, {
      Built: ({ reports, file, bytes }) =>
        Effect.sync(() => {
          printSoft(reports);
          process.stdout.write(`balade wrote ${file} (${size(bytes)})\n`);
        }),
      BuildNotRun: ({ message }) => Effect.sync(() => stopMessage(message)),
      BuildFailed: ({ reports }) => Effect.sync(() => stopReports(reports)),
    });
  }),
).pipe(Command.withDescription("Export one self-contained HTML file"));

const size = (bytes: number): string =>
  bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1000)} kB`;

const balade = Command.make("balade").pipe(
  Command.withDescription("Narrated code walkthroughs for pull requests"),
  Command.withSubcommands([check, open, build]),
);

NodeRuntime.runMain(Command.run(balade, { version: VERSION }).pipe(Effect.provide(cliLayer)));
