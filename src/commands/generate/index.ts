/** Interactive command boundary for provider login, model choice and draft reporting. */

import { createRequire } from "node:module";
import { Context, Effect, Option, Schema, Terminal } from "effect";
import { Argument, Command, Flag, Prompt } from "effect/unstable/cli";
import { AUTHORING_PACKAGE_VERSION } from "../../authoring/package.js";
import type { Lang } from "../../contract/types.js";
import { parsePrTarget } from "../../git/pr.js";
import { getPreset, presetNames } from "../../preset/registry.js";
import { reportPresence, reportWaitingDuring } from "../../presence.js";
import { resolvePullHead } from "../../git/pr.js";
import { runReviewSession } from "../../server/review.js";
import {
  formatText,
  plainTheme,
  sanitizeTerminalText,
  stdoutTheme,
  stderrTheme,
  stopMessage,
  warningText,
  writeStderr,
  writeStdout,
  type Theme,
} from "../../terminal.js";
import {
  AuthorDiscoveryFailed,
  LoginCancelled,
  LoginFailed,
  WalkthroughAuthor,
  type AuthoringPreset,
  type AuthorLoginMethod,
  type AuthorModel,
  type AuthorProgress,
  type AuthorProgressMode,
  type LoginInteraction,
  type LoginNotification,
  type LoginPrompt,
  type LoginSecretPrompt,
} from "../../pi/author.js";
import { generateErrorMessage, runGeneration, type GenerateError } from "./pipeline.js";
import {
  inspectExistingWalkthroughs,
  planSupersession,
  type ExistingWalkthrough,
  type RefreshingWalkthrough,
  type SupersededWalkthrough,
} from "./output.js";
import {
  matchingModels,
  modelSelectionFromFlags,
  modelsForPicker,
  NoProviderAuthenticated,
  noProviderMessage,
  orderedLoginMethods,
  preferredModel,
  type ModelFilter,
  type ModelSelection,
} from "./selection.js";

type GenerationFacets = { preset?: AuthoringPreset; lang?: Lang; guidance?: string };
type ChoiceDescriptionFacet = { description?: string };

const target = Argument.string("pr").pipe(
  Argument.withDescription("Bare pull request number, URL, or quoted '#number'"),
);

const provider = Flag.string("provider").pipe(
  Flag.withDescription("Pi provider id; partial or unavailable selections open the picker"),
  Flag.optional,
);

const model = Flag.string("model").pipe(
  Flag.withDescription("Pi model id; partial or unavailable selections open the picker"),
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
        Option.getOrElse(config.lang, () => "en" as const),
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

      const selected = yield* selectAuthorModel(selection);
      const progressMode: AuthorProgressMode = config.verbose ? "verbose" : "compact";
      const progress = makeGenerationProgress(writeStdout, progressMode, stdoutTheme);
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
        progressMode,
        progress,
      });
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

const selectAuthorModel = Effect.fn("selectAuthorModel")(function* (selection: ModelSelection) {
  const author = yield* WalkthroughAuthor;
  const rememberSelected = (selected: AuthorModel) =>
    author.rememberModel(selected).pipe(
      Effect.catchTag("AuthorPreferenceWriteFailed", () =>
        Effect.sync(() => {
          writeStderr(
            `${stderrTheme.warning("warning")} Pi's model preference could not be saved; this run will continue.\n`,
          );
        }),
      ),
    );
  let available = yield* author.availableModels;
  const filter: ModelFilter = selection._tag === "Choose" ? selection.filter : {};
  if (filter.providerId !== undefined && filter.modelId !== undefined) {
    const selected = matchingModels(available, filter)[0];
    if (selected !== undefined) {
      yield* rememberSelected(selected);
      announceModel(selected);
      return selected;
    }
  }

  if (selection._tag === "UsePreference") {
    const preference = yield* author.modelPreference.pipe(
      Effect.catchTag("AuthorPreferenceReadFailed", () =>
        Effect.sync(() => {
          writeStderr(
            `${stderrTheme.warning("warning")} Pi's saved model preference could not be read; choose a model.\n`,
          );
          return Option.none();
        }),
      ),
    );
    const saved = preferredModel(available, preference);
    if (Option.isSome(saved)) {
      announceModel(saved.value, "saved preference");
      return saved.value;
    }
  }

  const providerModels =
    filter.providerId === undefined
      ? []
      : matchingModels(available, { providerId: filter.providerId });
  let methods: readonly AuthorLoginMethod[] = [];
  if (available.length === 0) {
    const allMethods = yield* author.loginMethods;
    const requestedMethods = orderedLoginMethods(allMethods, filter.providerId);
    methods =
      requestedMethods.length > 0 ? requestedMethods : orderedLoginMethods(allMethods, undefined);
  } else if (filter.providerId !== undefined && providerModels.length === 0) {
    methods = orderedLoginMethods(yield* author.loginMethods, filter.providerId);
  }
  if (methods.length > 0) {
    yield* reportWaitingDuring(
      Effect.gen(function* () {
        const method = yield* Prompt.run(
          Prompt.select({
            message: "Log in to a Pi provider",
            choices: methods.map((candidate) => ({
              title: `${candidate.providerName} — ${candidate.label}`,
              value: candidate,
              description:
                candidate.billing === "anthropic-extra-usage"
                  ? anthropicBillingCaveat()
                  : `${candidate.method === "oauth" ? "Subscription" : "API key"} authentication`,
            })),
          }),
        );
        if (method.billing === "anthropic-extra-usage") {
          writeStdout(`${anthropicBillingCaveat()}\n`);
        }
        const promptContext = yield* Effect.context<Prompt.Environment>();
        yield* author.login(method, loginInteraction(promptContext));
      }),
    );
    available = yield* author.availableModels;
  } else if (available.length === 0) {
    return yield* new NoProviderAuthenticated({ requested: requestedModel(filter) });
  }

  const picker = modelsForPicker(available, filter);
  if (picker.models.length === 0) {
    return yield* new NoProviderAuthenticated({ requested: requestedModel(filter) });
  }
  if (picker.usedFallback) {
    writeStderr(
      `${stderrTheme.warning("warning")} No available Pi model matches ${requestedModel(filter)}; choose from the available models.\n`,
    );
  }

  const selected = yield* reportWaitingDuring(
    Prompt.run(
      Prompt.select({
        message: "Choose the provider and model",
        choices: picker.models.map((candidate) => ({
          title: `${candidate.providerName} — ${candidate.modelName}`,
          value: candidate,
          description:
            candidate.providerId === "anthropic"
              ? anthropicBillingCaveat()
              : `${candidate.providerId}/${candidate.modelId}`,
        })),
      }),
    ),
  );
  yield* rememberSelected(selected);
  announceModel(selected);
  return selected;
});

function loginInteraction(context: Context.Context<Prompt.Environment>): LoginInteraction {
  const runPrompt = Effect.runPromiseWith(context);
  return {
    prompt: (prompt) =>
      runPrompt(loginPrompt(prompt), prompt.signal === undefined ? {} : { signal: prompt.signal }),
    secret: (prompt) =>
      runPrompt(
        loginSecretPrompt(prompt),
        prompt.signal === undefined ? {} : { signal: prompt.signal },
      ),
    notify: printLoginNotification,
  };
}

function loginPrompt(prompt: LoginPrompt) {
  if (prompt.type === "select" && prompt.options.length > 0) {
    return Prompt.run(
      Prompt.select({
        message: prompt.message,
        choices: prompt.options.map((option) => {
          const facets: ChoiceDescriptionFacet = {};
          if (option.description !== undefined) facets.description = option.description;
          return { title: option.label, value: option.id, ...facets };
        }),
      }),
    );
  }
  if (prompt.type === "select") return Prompt.run(Prompt.text({ message: prompt.message }));
  const message =
    prompt.placeholder === undefined ? prompt.message : `${prompt.message} (${prompt.placeholder})`;
  return Prompt.run(Prompt.text({ message }));
}

function loginSecretPrompt(prompt: LoginSecretPrompt) {
  const message =
    prompt.placeholder === undefined ? prompt.message : `${prompt.message} (${prompt.placeholder})`;
  return Prompt.run(Prompt.password({ message }));
}

function printLoginNotification(event: LoginNotification): void {
  switch (event.type) {
    case "info":
      writeStdout(`${event.message}\n`);
      for (const link of event.links) {
        writeStdout(`${link.label === undefined ? "Open" : link.label}: ${link.url}\n`);
      }
      break;
    case "auth_url":
      writeStdout(`${event.instructions ?? "Open this URL to authenticate:"}\n${event.url}\n`);
      break;
    case "device_code":
      writeStdout(`Open ${event.verificationUri} and enter code ${event.userCode}.\n`);
      break;
    case "progress":
      writeStdout(`${event.message}\n`);
      break;
  }
}

export function makeGenerationProgress(
  write: (value: string) => void,
  mode: AuthorProgressMode = "compact",
  theme: Theme = plainTheme,
): (event: AuthorProgress) => void {
  let turn = 0;
  const announced = new Set<string>();
  return (event) => {
    switch (event._tag) {
      case "AuthorNotice":
        write(warningText(event, theme));
        break;
      case "AuthorUsageUpdated": {
        turn++;
        const usage = event.usage;
        write(
          theme.muted(
            `Turn ${turn}: ${usage.total.toLocaleString("en-US")} cumulative tokens ` +
              `(in ${usage.input.toLocaleString("en-US")}, out ${usage.output.toLocaleString("en-US")}, ` +
              `cache ${usage.cacheRead.toLocaleString("en-US")}/${usage.cacheWrite.toLocaleString("en-US")}); ` +
              `cumulative cost $${usage.cost.toFixed(4)}`,
          ) + "\n",
        );
        break;
      }
      case "AuthorAssistantText":
        if (mode === "verbose") {
          write(`[assistant]\n${withTrailingNewline(sanitizeTerminalText(event.text))}`);
        }
        break;
      case "AuthorToolStarted":
        if (mode === "verbose") {
          const input = sanitizeTerminalText(event.input);
          write(`[${sanitizeTerminalText(event.name)}]${input === "" ? "" : ` ${input}`}\n`);
        } else {
          const message = progressMessage(event.name);
          if (!announced.has(message)) {
            announced.add(message);
            write(`${message}\n`);
          }
        }
        break;
      case "AuthorToolFinished":
        if (mode === "verbose") {
          if (event.output !== "") write(withTrailingNewline(sanitizeTerminalText(event.output)));
          write(`[/${sanitizeTerminalText(event.name)}${event.failed ? " error" : ""}]\n`);
        }
        break;
    }
  };
}

function withTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function progressMessage(tool: string): string {
  switch (tool) {
    case "list_pr_changes":
    case "list_source_files":
      return "Inspecting pull-request changes…";
    case "read_pr_diff":
      return "Reading relevant diffs…";
    case "search_source":
      return "Searching pinned source…";
    case "read_source":
    case "read_base_source":
      return "Confirming pinned source ranges…";
    case "submit_walkthrough":
      return "Submitting the walkthrough draft…";
    default:
      return "Authoring the walkthrough…";
  }
}

function announceModel(model: AuthorModel, source?: string): void {
  writeStdout(
    `Provider/model: ${stdoutTheme.emphasis(`${model.providerName} — ${model.modelName}`)} (${model.providerId}/${model.modelId})${source === undefined ? "" : ` — ${source}`}\n`,
  );
  if (model.providerId === "anthropic") writeStdout(`${anthropicBillingCaveat()}\n`);
}

function anthropicBillingCaveat(): string {
  return (
    "Anthropic subscription login in third-party tools is billed per token as extra usage; " +
    "it does not draw on Claude plan limits."
  );
}

function requestedModel(filter: ModelFilter): string {
  return `${filter.providerId ?? "any provider"}/${filter.modelId ?? "any model"}`;
}

function repairSummary(repairs: number): string {
  return repairs === 0 ? "" : ` after ${repairs} repair ${repairs === 1 ? "turn" : "turns"}`;
}

export function generationSuccessText(
  result: {
    readonly file: string;
    readonly ranges: number;
    readonly repairs: number;
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
  },
  theme: Theme = plainTheme,
): string {
  const ranges = `${result.ranges} code ${result.ranges === 1 ? "range" : "ranges"}`;
  return (
    `${theme.ok("Check passed")}${repairSummary(result.repairs)}: ${ranges} verified.\n` +
    `Generated ${theme.emphasis(result.file)}.\n`
  );
}

/** The TTY confirmation for a same-head or unreadably stamped walkthrough. */
export function generationReplaceQuestion(undecided: readonly ExistingWalkthrough[]): string {
  const first = undecided[0];
  if (undecided.length === 1 && first !== undefined) {
    const state =
      first.stamp._tag === "Stamped"
        ? "already stamped at this head"
        : "unreadable walkthrough stamp";
    return `Replace ${sanitizeTerminalText(first.relativeFile)} (${state})? Pass --dir instead to keep both.`;
  }
  const files = undecided
    .map((candidate) => sanitizeTerminalText(candidate.relativeFile))
    .join(", ");
  return `Replace ${files}? Pass --dir instead to keep both.`;
}

/** The non-interactive refusal, at t=0 where it costs nothing. */
export function generationBlockedMessage(undecided: readonly ExistingWalkthrough[]): string {
  const first = undecided[0];
  if (undecided.length === 1 && first !== undefined) {
    const state =
      first.stamp._tag === "Stamped"
        ? "is already stamped at the current pull-request head"
        : "already exists without a readable walkthrough stamp";
    return `${first.relativeFile} ${state}. Re-run with --force to replace it, or use --dir to redirect the output.`;
  }
  const files = undecided.map((candidate) => candidate.relativeFile).join(", ");
  return `${files} already exist for this pull request. Re-run with --force to replace them, or use --dir to redirect the output.`;
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
        `Refreshing ${theme.emphasis(sanitizeTerminalText(candidate.relativeFile))} (${shortCommit(sanitizeTerminalText(candidate.stamp.pin))} → ${shortCommit(currentHead)}).\n`,
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

type GenerationCliError =
  | GenerateError
  | AuthorDiscoveryFailed
  | LoginFailed
  | LoginCancelled
  | NoProviderAuthenticated
  | Terminal.QuitError;

function generationCliErrorMessage(error: GenerationCliError): string {
  switch (error._tag) {
    case "LoginFailed":
      return loginErrorMessage(error);
    case "AuthorDiscoveryFailed":
      return "Pi providers and models could not be loaded. Check the local Pi installation and try again.";
    case "LoginCancelled":
      return "Generation cancelled.";
    case "NoProviderAuthenticated":
      return noProviderMessage(error);
    case "QuitError":
      return "Generation cancelled.";
    default:
      return generateErrorMessage(error);
  }
}

function loginErrorMessage(error: LoginFailed): string {
  switch (error.reason) {
    case "oauth":
      return `Pi could not complete ${error.provider} subscription login. Retry interactively, or run the pi CLI login first.`;
    case "auth":
      return `Pi rejected the ${error.provider} credential. Check the account or API key and log in again.`;
    case "provider":
      return `Pi could not initialize ${error.provider}. Check the provider configuration and try again.`;
    case "unknown":
      return `Pi could not authenticate ${error.provider}. Run the pi CLI login, then retry balade generate.`;
  }
}
