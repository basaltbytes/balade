#!/usr/bin/env node
/** Effects stay at this edge: the commands read flags, call the pure compile,
    check, build and server core, and print. */

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { runBuild } from "./build/run.js";
import { formatJson, formatText } from "./check/report.js";
import { runCheck, type CheckOutcome } from "./check/run.js";
import { APP_BUNDLE_MISSING, findAppBundle, serve } from "./server/serve.js";
import { prepareSession, type Selection } from "./server/session.js";

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
  Effect.sync(() => {
    const outcome = runCheck({ cwd: process.cwd(), paths: config.files });
    process.stdout.write(config.json ? `${formatJson(outcome)}\n` : formatText(outcome));
    if (!outcome.ok) process.exitCode = 1;
  }),
).pipe(
  Command.withDescription(
    "Validate walkthroughs: schema, git references, expect= and range echoes",
  ),
);

const open = Command.make("open", { files, lang: langFlag, port: portFlag }, (config) =>
  Effect.gen(function* () {
    const appDir = findAppBundle();
    if (appDir === null) {
      process.stderr.write(`${APP_BUNDLE_MISSING}\n`);
      process.exitCode = 1;
      return;
    }

    const selection: Selection =
      config.files.length > 0 ? { kind: "files", paths: config.files } : { kind: "discovered" };
    const prepared = prepareSession({
      cwd: process.cwd(),
      selection,
      ...(Option.isSome(config.lang) ? { lang: config.lang.value } : {}),
    });
    if (prepared.kind !== "ready") {
      stop(prepared);
      return;
    }

    const session = prepared.session;
    yield* Effect.addFinalizer(() => Effect.sync(() => session.close()));
    printSoft(session.outcome);

    const url = yield* serve({ appDir, port: config.port, api: session.api });
    process.stdout.write(`balade is serving ${served(session.paths)} at ${url}\n`);
    yield* Effect.never;
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
  Effect.sync(() => {
    const result = runBuild({
      cwd: process.cwd(),
      paths: config.files,
      ...(Option.isSome(config.lang) ? { lang: config.lang.value } : {}),
      ...(Option.isSome(config.out) ? { out: config.out.value } : {}),
    });
    if (result.kind !== "built") {
      stop(result);
      return;
    }
    printSoft(result.outcome);
    process.stdout.write(`balade wrote ${result.file} (${size(result.bytes)})\n`);
  }),
).pipe(Command.withDescription("Export one self-contained HTML file"));

const size = (bytes: number): string =>
  bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1000)} kB`;

const balade = Command.make("balade").pipe(
  Command.withDescription("Narrated code walkthroughs for pull requests"),
  Command.withSubcommands([check, open, build]),
);

NodeRuntime.runMain(
  Command.run(balade, { version: VERSION }).pipe(Effect.provide(NodeServices.layer)),
);
