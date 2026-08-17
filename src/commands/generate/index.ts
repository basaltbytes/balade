/** Interactive command boundary for provider login, model choice and draft reporting. */

import { createRequire } from "node:module";
import { Effect, Option, Schema, Terminal } from "effect";
import { Argument, Command, Flag, Prompt } from "effect/unstable/cli";
import {
  AgentModelManager,
  modelSelectionFromFlags,
  type AgentModelConfigurationError,
} from "../../agent/model.js";
import { agentModelErrorMessage } from "../../agent/terminal.js";
import { AUTHORING_PACKAGE_VERSION } from "../../authoring/package.js";
import { langOfMeta } from "../../contract/schema.js";
import type { Lang } from "../../contract/types.js";
import { parsePrTarget } from "../../git/pr.js";
import { getPreset, presetNames } from "../../preset/registry.js";
import { reportPresence, reportWaitingDuring } from "../../presence.js";
import { resolvePullHead } from "../../git/pr.js";
import { runReviewSession } from "../../server/review.js";
import {
  formatText,
  makeSpinner,
  plainTheme,
  sanitizeTerminalText,
  stdoutTheme,
  stopMessage,
  warningText,
  writeStdout,
  type Theme,
} from "../../terminal.js";
import type { AuthoringPreset } from "../../pi/author.js";
import { generateErrorMessage, runGeneration, type GenerateError } from "./pipeline.js";
import type { GenerationTiming } from "./progress.js";
import {
  generationStatusText,
  generationTimingText,
  makeGenerationProgress,
  type GenerationProgressMode,
} from "./progress-terminal.js";
import {
  inspectExistingWalkthroughs,
  planSupersession,
  type ExistingWalkthrough,
  type RefreshingWalkthrough,
  type SupersededWalkthrough,
} from "./output.js";

type GenerationFacets = { preset?: AuthoringPreset; lang?: Lang; guidance?: string };

const target = Argument.string("pr").pipe(
  Argument.withDescription("Bare pull request number, URL, or quoted '#number'"),
);

const provider = Flag.string("provider").pipe(
  Flag.withDescription("Agent provider id; partial or unavailable selections open the picker"),
  Flag.optional,
);

const model = Flag.string("model").pipe(
  Flag.withDescription("Agent model id; partial or unavailable selections open the picker"),
  Flag.optional,
);

const preset = Flag.string("preset").pipe(
  Flag.withDescription(
    `Activate a preset's tags for this walkthrough (${presetNames().join(", ")})`,
  ),
  Flag.optional,
);

const lang = Flag.choice("lang", ["en", "fr"]).pipe(
  Flag.withDescription("Walkthrough language; the draft is authored and stamped in it"),
  Flag.optional,
);

const directory = Flag.string("dir").pipe(
  Flag.withDescription("Repository-relative directory for the generated walkthrough"),
  Flag.withDefault(".agents/walkthroughs"),
);

const guidance = Flag.string("prompt").pipe(
  Flag.withDescription(
    "Additional reviewer guidance and steering appended to the base prompt for this run",
  ),
  Flag.optional,
  /* Trimmed at the boundary; an all-whitespace `--prompt` is absent, never sent to the model. */
  Flag.map((value) =>
    value.pipe(
      Option.map((text) => text.trim()),
      Option.filter((text) => text !== ""),
    ),
  ),
);

const budget = Flag.choice("budget", ["low", "medium", "high"]).pipe(
  Flag.withDescription(
    "Inspection budget: low fixes small caps, medium scales with the pull request, high removes the caps",
  ),
  Flag.withDefault("medium" as const),
);

const force = Flag.boolean("force").pipe(
  Flag.withDescription(
    "Replace an existing same-head walkthrough without confirmation (non-interactive runs)",
  ),
);

const verbose = Flag.boolean("verbose").pipe(
  Flag.withDescription("Show Pi assistant text, tool inputs/results, and successful range echoes"),
);

const trustHeadInstructions = Flag.boolean("trust-head-instructions").pipe(
  Flag.withDescription("Apply AGENTS.md or CLAUDE.md files changed by the pull request"),
);

const noOpen = Flag.boolean("no-open").pipe(
  Flag.withDescription("Generate only: print the path and open hint without starting a server"),
);

const noBrowser = Flag.boolean("no-browser").pipe(
  Flag.withDescription("Serve headless: print the URL without opening a browser"),
);

const port = Flag.integer("port").pipe(
  Flag.withDescription("Review-server port; 0 asks the system for a free one"),
  Flag.withDefault(0),
);

const PackageManifest = Schema.Struct({ version: Schema.String });
const packageManifest: unknown = createRequire(import.meta.url)("../../../package.json");
const packageVersion = Schema.decodeUnknownSync(PackageManifest)(packageManifest).version;

export const generateCommand = Command.make(
  "generate",
  {
    pr: target,
    provider,
    model,
    preset,
    lang,
    directory,
    guidance,
    budget,
    force,
    verbose,
    trustHeadInstructions,
    noOpen,
    noBrowser,
    port,
  },
  (config) =>
    Effect.gen(function* () {
      writeStdout(
        stdoutTheme.muted(
          `balade ${packageVersion} (authoring package ${AUTHORING_PACKAGE_VERSION})\n`,
        ),
      );
      const pull = parsePrTarget(config.pr);
      if (pull === null) {
        stopMessage(
          "Name one GitHub pull request: `balade generate 96` or `balade generate <pr-url>`.",
        );
        return;
      }
      const active = Option.getOrUndefined(config.preset);
      const chosen = active === undefined ? undefined : getPreset(active);
      if (active !== undefined && chosen === undefined) {
        stopMessage(
          `balade: unknown preset \`${active}\`. Available: ${presetNames().join(", ")}.`,
        );
        return;
      }
      const selection = modelSelectionFromFlags(config.provider, config.model);
      yield* reportPresence("working");
      const source = yield* resolvePullHead({ cwd: process.cwd(), target: pull });
      for (const notice of source.notices) {
        writeStdout(warningText(notice, stdoutTheme));
      }

      /* The overwrite decision resolves here, before any paid turn. */
      const existing = yield* inspectExistingWalkthroughs({
        root: source.root,
        directory: config.directory,
        pullNumber: source.pull.number,
      });
      const plan = planSupersession(
        existing,
        source.pin,
        langOfMeta(Option.getOrUndefined(config.lang)),
      );
      if (plan.undecided.length > 0 && !config.force) {
        if (process.stdin.isTTY === true) {
          const replace = yield* reportWaitingDuring(
            Prompt.run(Prompt.confirm({ message: generationReplaceQuestion(plan.undecided) })),
          );
          if (!replace) {
            stopMessage("Generation cancelled.");
            return;
          }
        } else {
          stopMessage(generationBlockedMessage(plan.undecided));
          return;
        }
      }
      writeStdout(generationRefreshText(plan.refreshing, source.pin, stdoutTheme));

      const agentModels = yield* AgentModelManager;
      const selected = yield* agentModels.configure(selection);
      const progressMode: GenerationProgressMode = config.verbose ? "verbose" : "compact";
      const spinner = makeSpinner();
      const progress = makeGenerationProgress(
        (value) => spinner.print(() => writeStdout(value)),
        progressMode,
        stdoutTheme,
        (status) => spinner.update(generationStatusText(status)),
      );
      const generationFacets: GenerationFacets = {};
      if (chosen !== undefined) {
        generationFacets.preset = { name: chosen.name, authoring: chosen.authoring };
      }
      if (Option.isSome(config.lang)) generationFacets.lang = config.lang.value;
      if (Option.isSome(config.guidance)) generationFacets.guidance = config.guidance.value;
      const result = yield* runGeneration({
        source,
        model: selected,
        ...generationFacets,
        budget: config.budget,
        directory: config.directory,
        supersede: [...plan.refreshing, ...plan.undecided],
        headInstructionPolicy: config.trustHeadInstructions ? "trust-changed" : "omit-changed",
        progress,
      }).pipe(Effect.ensuring(Effect.sync(() => spinner.stop())));
      /* Authoring is over on both branches; the serve loop below is the reviewer's time. */
      yield* reportPresence("settled");
      writeStdout(generationSupersededText(result.superseded, result.report.file, stdoutTheme));
      if (result.siblings.length > 0) {
        writeStdout(generationSiblingText(source.pull.number, result.siblings, stdoutTheme));
      }
      if (result._tag === "Generated") {
        if (progressMode === "verbose") {
          writeStdout(formatText({ reports: [result.report] }, stdoutTheme));
        }
        const summary = {
          file: result.report.file,
          ranges: result.report.ranges.length,
          repairs: result.repairs,
          timing: result.timing,
        };
        if (config.noOpen) {
          writeStdout(generationSuccessText(summary, stdoutTheme));
          return;
        }
        writeStdout(generationSummaryText(summary, stdoutTheme));
        return yield* runReviewSession({
          session: {
            cwd: source.root,
            selection: { kind: "files", paths: [result.file] },
          },
          port: config.port,
          browserMode: config.noBrowser ? "headless" : "launch",
        });
      } else {
        writeStdout(formatText({ reports: [result.report] }, stdoutTheme));
        stopMessage(
          `balade kept ${result.file} after check still found diagnostics${repairSummary(result.repairs)}. Edit it and run balade check ${result.file}.`,
        );
      }
    }).pipe(
      Effect.scoped,
      Effect.catch((error) =>
        Effect.sync(() => {
          if (error._tag === "RepairFailed") {
            writeStdout(formatText({ reports: [error.report] }, stdoutTheme));
          }
          stopMessage(generationCliErrorMessage(error));
        }),
      ),
    ),
).pipe(Command.withDescription("Draft, validate, and open a walkthrough for a pull request"));

function repairSummary(repairs: number): string {
  return repairs === 0 ? "" : ` after ${repairs} repair ${repairs === 1 ? "turn" : "turns"}`;
}

export function generationSuccessText(
  result: {
    readonly file: string;
    readonly ranges: number;
    readonly repairs: number;
    readonly timing: GenerationTiming;
  },
  theme: Theme = plainTheme,
): string {
  return (
    generationSummaryText(result, theme) +
    `Review it with:\n  ${theme.emphasis(`balade open ${result.file}`)}\n`
  );
}

export function generationSummaryText(
  result: {
    readonly file: string;
    readonly ranges: number;
    readonly repairs: number;
    readonly timing: GenerationTiming;
  },
  theme: Theme = plainTheme,
): string {
  const ranges = `${result.ranges} code ${result.ranges === 1 ? "range" : "ranges"}`;
  return (
    `${theme.ok("Check passed")}${repairSummary(result.repairs)}: ${ranges} verified.\n` +
    `${theme.muted(generationTimingText(result.timing))}\n` +
    `Generated ${theme.emphasis(result.file)}.\n`
  );
}

/** Why one existing file needs an explicit decision before it is replaced. */
const undecidedState = (candidate: ExistingWalkthrough): string =>
  candidate.stamp._tag === "Stamped"
    ? "already stamped at the current head"
    : "missing a readable walkthrough stamp";

const undecidedFiles = (undecided: readonly ExistingWalkthrough[]): string =>
  undecided.map((candidate) => sanitizeTerminalText(candidate.relativeFile)).join(", ");

/** The TTY confirmation for a same-head or unreadably stamped walkthrough. */
export function generationReplaceQuestion(undecided: readonly ExistingWalkthrough[]): string {
  const first = undecided[0];
  const state = undecided.length === 1 && first !== undefined ? ` (${undecidedState(first)})` : "";
  return `Replace ${undecidedFiles(undecided)}${state}? Pass --dir instead to keep both.`;
}

/** The non-interactive refusal, at t=0 where it costs nothing. */
export function generationBlockedMessage(undecided: readonly ExistingWalkthrough[]): string {
  const first = undecided[0];
  const state =
    undecided.length === 1 && first !== undefined
      ? `is ${undecidedState(first)}. Re-run with --force to replace it`
      : "already exist for this pull request. Re-run with --force to replace them";
  return `${undecidedFiles(undecided)} ${state}, or use --dir to redirect the output.`;
}

/** Refreshing a stale-stamped walkthrough is unambiguous intent: announce, never ask. */
export function generationRefreshText(
  refreshing: readonly RefreshingWalkthrough[],
  currentHead: string,
  theme: Theme = plainTheme,
): string {
  return refreshing
    .map(
      (candidate) =>
        /* The pins are schema-validated hex; only the filename needs sanitizing. */
        `Refreshing ${theme.emphasis(sanitizeTerminalText(candidate.relativeFile))} (${shortCommit(candidate.stamp.pin)} → ${shortCommit(currentHead)}).\n`,
    )
    .join("");
}

/** One line per superseded file; only uncommitted content leaves a copy behind. */
export function generationSupersededText(
  superseded: readonly SupersededWalkthrough[],
  writtenFile: string,
  theme: Theme = plainTheme,
): string {
  return superseded
    .flatMap((entry) => {
      if (entry.retainedAt !== undefined) {
        return [
          `Superseded ${sanitizeTerminalText(entry.file)}; its uncommitted content is kept at ${theme.emphasis(sanitizeTerminalText(entry.retainedAt))}.\n`,
        ];
      }
      return entry.file === writtenFile
        ? []
        : [`Superseded ${sanitizeTerminalText(entry.file)}.\n`];
    })
    .join("");
}

const shortCommit = (commit: string): string => commit.slice(0, 7);

export function generationSiblingText(
  pullNumber: number,
  files: readonly string[],
  theme: Theme = plainTheme,
): string {
  return warningText(
    {
      code: "walkthrough-siblings",
      message: `Other walkthroughs for PR ${pullNumber}: ${files.join(", ")}.`,
      hint: "Remove any sibling that no longer describes a walkthrough you want to keep.",
    },
    theme,
  );
}

type GenerationCliError = GenerateError | AgentModelConfigurationError | Terminal.QuitError;

function generationCliErrorMessage(error: GenerationCliError): string {
  switch (error._tag) {
    case "LoginCancelled":
    case "AgentModelSelectionCancelled":
    case "QuitError":
      return "Generation cancelled.";
    case "LoginFailed":
    case "AuthorDiscoveryFailed":
    case "NoProviderAuthenticated":
      return agentModelErrorMessage(error);
    default:
      return generateErrorMessage(error);
  }
}
