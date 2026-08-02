#!/usr/bin/env node
/** Command boundary: read flags, run the typed build/session Effects, translate
    their failures into terminal output, and keep diagnostics as report values. */

import { NodeRuntime } from "@effect/platform-node";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { buildErrorMessage, runBuild } from "./build/run.js";
import { formatJson, formatText } from "./check/report.js";
import { runCheck, type CheckOutcome } from "./check/run.js";
import { cliLayer } from "./live.js";
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
      if (!outcome.ok) process.exitCode = 1;
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
            stop({ kind: "note", message: error.note });
            return Option.none<string>();
          }),
        ),
      );
      if (Option.isNone(appDir)) return;

      const target = parseOpenTarget(config.files);
      if (target.kind === "invalid") {
        stop({ kind: "note", message: target.message });
        return;
      }
      const selection =
        target.kind === "pr"
          ? yield* locateSelection(target.pr).pipe(
              Effect.map(Option.some),
              Effect.catch((error) =>
                Effect.sync(() => {
                  stop({ kind: "note", message: locateErrorMessage(error) });
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
            stop({ kind: "note", message: sessionErrorMessage(error) });
            return Option.none();
          }),
        ),
      );
      if (Option.isNone(prepared)) return;
      if (prepared.value.kind !== "ready") {
        stop(prepared.value);
        return;
      }

      const session = prepared.value.session;
      printSoft(session.outcome);

      const url = yield* serve({ appDir: appDir.value, port: config.port, api: session.api });
      process.stdout.write(`balade is serving ${served(session.paths)} at ${url}\n`);
      return yield* Effect.never;
    }).pipe(Effect.scoped),
).pipe(Command.withDescription("Serve the interactive walkthrough app"));

/** The boundary echo is a `check` affordance for the author; `open` shows diagnostics. */
const diagnosticsOnly = (outcome: CheckOutcome): CheckOutcome => ({
  ...outcome,
  reports: outcome.reports.map((report) => ({ ...report, ranges: [] })),
});

/** Prints why a soft command stops — a note, or the outcome that failed — and sets the exit code. */
const stop = (
  result: { kind: "note"; message: string } | { kind: "failed"; outcome: CheckOutcome },
): void => {
  if (result.kind === "note") process.stderr.write(`${result.message}\n`);
  else process.stdout.write(formatText(diagnosticsOnly(result.outcome)));
  process.exitCode = 1;
};

/** Soft commands: what did not resolve is printed here and rides on as error cards. */
const printSoft = (outcome: CheckOutcome): void => {
  const notes = diagnosticsOnly(outcome);
  if (notes.reports.some((report) => report.diagnostics.length > 0)) {
    process.stdout.write(formatText(notes));
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
          stop({ kind: "note", message: buildErrorMessage(error) });
          return Option.none();
        }),
      ),
    );
    if (Option.isNone(result)) return;
    if (result.value.kind !== "built") {
      stop(result.value);
      return;
    }
    printSoft(result.value.outcome);
    process.stdout.write(`balade wrote ${result.value.file} (${size(result.value.bytes)})\n`);
  }),
).pipe(Command.withDescription("Export one self-contained HTML file"));

const size = (bytes: number): string =>
  bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1000)} kB`;

const balade = Command.make("balade").pipe(
  Command.withDescription("Narrated code walkthroughs for pull requests"),
  Command.withSubcommands([check, open, build]),
);

NodeRuntime.runMain(Command.run(balade, { version: VERSION }).pipe(Effect.provide(cliLayer)));
