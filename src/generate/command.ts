/** Interactive command boundary for provider login, model choice and draft reporting. */

import { Context, Effect, Option, Terminal } from "effect";
import { Argument, Command, Flag, Prompt } from "effect/unstable/cli";
import { stripVTControlCharacters } from "node:util";
import { formatText } from "../check/report.js";
import { parsePrTarget } from "../pr/target.js";
import {
  AuthorDiscoveryFailed,
  LoginCancelled,
  LoginFailed,
  WalkthroughAuthor,
  type AuthorModel,
  type AuthorProgress,
  type LoginInteraction,
  type LoginNotification,
  type LoginPrompt,
  type LoginSecretPrompt,
} from "./author.js";
import {
  generateErrorMessage,
  prepareGeneration,
  runGeneration,
  type GenerateError,
} from "./run.js";
import {
  matchingModels,
  modelsForPicker,
  NoProviderAuthenticated,
  noProviderMessage,
  orderedLoginMethods,
  preferredModelForRun,
} from "./select.js";

const target = Argument.string("pr").pipe(
  Argument.withDescription("Pull request URL, #number, or bare number"),
);

const provider = Flag.string("provider").pipe(
  Flag.withDescription("Pi provider id; partial or unavailable selections open the picker"),
  Flag.optional,
);

const model = Flag.string("model").pipe(
  Flag.withDescription("Pi model id; partial or unavailable selections open the picker"),
  Flag.optional,
);

const directory = Flag.string("dir").pipe(
  Flag.withDescription("Repository-relative directory for the generated walkthrough"),
  Flag.withDefault("walkthroughs"),
);

const verbose = Flag.boolean("verbose").pipe(
  Flag.withDescription("Show Pi assistant text, tool inputs/results, and successful range echoes"),
);

export const generateCommand = Command.make(
  "generate",
  { pr: target, provider, model, directory, verbose },
  (config) =>
    Effect.gen(function* () {
      const pull = parsePrTarget(config.pr);
      if (pull === null) {
        stopMessage("Name one GitHub pull request: `balade generate <pr-url|#n>`.");
        return;
      }
      const providerId = selectionFlagValue(config.provider);
      const modelId = selectionFlagValue(config.model);
      const hasSelectionFlag = Option.isSome(config.provider) || Option.isSome(config.model);
      const prepared = yield* prepareGeneration({ cwd: process.cwd(), target: pull });
      for (const notice of prepared.notices) {
        writeStdout(`warning ${notice.code}\n  ${notice.message}\n  fix ${notice.hint}\n`);
      }

      const selected = yield* selectAuthorModel(providerId, modelId, hasSelectionFlag);
      if (Option.isNone(selected)) {
        writeStdout("Generation cancelled.\n");
        return;
      }

      const progress = makeGenerationProgress(writeStdout, { verbose: config.verbose });
      const result = yield* runGeneration({
        source: prepared,
        model: selected.value,
        directory: config.directory,
        verbose: config.verbose,
        progress,
      });
      if (result._tag === "Generated") {
        if (config.verbose) writeStdout(formatText({ reports: [result.report] }));
        writeStdout(
          generationSuccessText({
            file: result.report.file,
            ranges: result.report.ranges.length,
            repairs: result.repairs,
          }),
        );
      } else {
        writeStdout(formatText({ reports: [result.report] }));
        writeStderr(
          `balade kept ${result.file} after check still found diagnostics${repairSummary(result.repairs)}. Edit it and run balade check ${result.file}.\n`,
        );
        process.exitCode = 1;
      }
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          if (error._tag === "RepairFailed") {
            writeStdout(formatText({ reports: [error.report] }));
          }
          stopMessage(generationCliErrorMessage(error));
        }),
      ),
    ),
).pipe(Command.withDescription("Draft and validate a walkthrough for a pull request"));

const selectAuthorModel = Effect.fn("selectAuthorModel")(function* (
  providerId: string | undefined,
  modelId: string | undefined,
  hasSelectionFlag: boolean,
) {
  const author = yield* WalkthroughAuthor;
  const rememberSelected = (selected: AuthorModel) =>
    author.rememberModel(selected).pipe(
      Effect.catchTag("AuthorPreferenceWriteFailed", () =>
        Effect.sync(() => {
          writeStderr(
            "warning Pi's model preference could not be saved; this run will continue.\n",
          );
        }),
      ),
    );
  let available = yield* author.availableModels;
  if (providerId !== undefined && modelId !== undefined) {
    const selected = matchingModels(available, providerId, modelId)[0];
    if (selected !== undefined) {
      yield* rememberSelected(selected);
      announceModel(selected);
      return Option.some(selected);
    }
  }

  const preference = hasSelectionFlag
    ? Option.none()
    : yield* author.modelPreference.pipe(
        Effect.catchTag("AuthorPreferenceReadFailed", () =>
          Effect.sync(() => {
            writeStderr("warning Pi's saved model preference could not be read; choose a model.\n");
            return Option.none();
          }),
        ),
      );
  const preferred = preferredModelForRun(available, preference, hasSelectionFlag);
  if (Option.isSome(preferred)) {
    announceModel(preferred.value, "saved preference");
    return preferred;
  }

  const allMethods = yield* author.loginMethods;
  const providerModels =
    providerId === undefined ? [] : matchingModels(available, providerId, undefined);
  const providerMethods = orderedLoginMethods(allMethods, providerId);
  const shouldLogin =
    available.length === 0 ||
    (providerId !== undefined && providerModels.length === 0 && providerMethods.length > 0);
  if (shouldLogin) {
    const methods =
      providerMethods.length > 0 ? providerMethods : orderedLoginMethods(allMethods, undefined);
    if (methods.length === 0) {
      return yield* new NoProviderAuthenticated({
        requested: requestedModel(providerId, modelId),
      });
    }
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
    available = yield* author.availableModels;
  }

  const picker = modelsForPicker(available, providerId, modelId);
  if (picker.models.length === 0) {
    return yield* new NoProviderAuthenticated({ requested: requestedModel(providerId, modelId) });
  }
  if (picker.usedFallback) {
    writeStderr(
      `warning No available Pi model matches ${requestedModel(providerId, modelId)}; choose from the available models.\n`,
    );
  }

  const selected = yield* Prompt.run(
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
  );
  announceModel(selected);
  const confirmed = yield* Prompt.run(
    Prompt.confirm({
      message: `Generate with ${selected.providerId}/${selected.modelId}?`,
      initial: true,
    }),
  );
  if (!confirmed) return Option.none<AuthorModel>();
  yield* rememberSelected(selected);
  return Option.some(selected);
});

export function selectionFlagValue(value: Option.Option<string>): string | undefined {
  const trimmed = Option.getOrUndefined(value)?.trim();
  return trimmed === "" ? undefined : trimmed;
}

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
        choices: prompt.options.map((option) => ({
          title: option.label,
          value: option.id,
          ...(option.description === undefined ? {} : { description: option.description }),
        })),
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
  options: { readonly verbose?: boolean } = {},
): (event: AuthorProgress) => void {
  let turn = 0;
  const announced = new Set<string>();
  return (event) => {
    if (event._tag === "AuthorUsageUpdated") {
      turn++;
      const usage = event.usage;
      write(
        `Turn ${turn}: ${usage.total.toLocaleString("en-US")} cumulative tokens ` +
          `(in ${usage.input.toLocaleString("en-US")}, out ${usage.output.toLocaleString("en-US")}, ` +
          `cache ${usage.cacheRead.toLocaleString("en-US")}/${usage.cacheWrite.toLocaleString("en-US")}); ` +
          `cost $${usage.cost.toFixed(4)}\n`,
      );
    } else if (options.verbose && event._tag === "AuthorAssistantText") {
      write(`[assistant]\n${withTrailingNewline(event.text)}`);
    } else if (options.verbose && event._tag === "AuthorToolStarted") {
      write(`[${event.name}]${event.input === "" ? "" : ` ${event.input}`}\n`);
    } else if (options.verbose && event._tag === "AuthorToolFinished") {
      if (event.output !== "") write(withTrailingNewline(event.output));
      write(`[/${event.name}${event.failed ? " error" : ""}]\n`);
    } else if (!options.verbose && event._tag === "AuthorToolStarted") {
      const message = progressMessage(event.name);
      if (!announced.has(message)) {
        announced.add(message);
        write(`${message}\n`);
      }
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
    case "read_source":
      return "Confirming pinned source ranges…";
    case "submit_walkthrough":
      return "Submitting the walkthrough draft…";
    default:
      return "Authoring the walkthrough…";
  }
}

function announceModel(model: AuthorModel, source?: string): void {
  writeStdout(
    `Provider/model: ${model.providerName} — ${model.modelName} (${model.providerId}/${model.modelId})${source === undefined ? "" : ` — ${source}`}\n`,
  );
  if (model.providerId === "anthropic") writeStdout(`${anthropicBillingCaveat()}\n`);
}

function anthropicBillingCaveat(): string {
  return (
    "Anthropic subscription login in third-party tools is billed per token as extra usage; " +
    "it does not draw on Claude plan limits."
  );
}

function requestedModel(providerId: string | undefined, modelId: string | undefined): string {
  return `${providerId ?? "any provider"}/${modelId ?? "any model"}`;
}

function repairSummary(repairs: number): string {
  return repairs === 0 ? "" : ` after ${repairs} repair ${repairs === 1 ? "turn" : "turns"}`;
}

export function generationSuccessText(result: {
  readonly file: string;
  readonly ranges: number;
  readonly repairs: number;
}): string {
  const ranges = `${result.ranges} code ${result.ranges === 1 ? "range" : "ranges"}`;
  return (
    `Check passed${repairSummary(result.repairs)}: ${ranges} verified.\n` +
    `Generated ${result.file}.\n` +
    `Review it with:\n  balade open ${result.file}\n`
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

const stopMessage = (message: string): void => {
  writeStderr(`${message}\n`);
  process.exitCode = 1;
};

export function sanitizeTerminalText(value: string): string {
  let safe = "";
  for (const character of stripVTControlCharacters(value)) {
    const point = character.codePointAt(0);
    if (
      point === undefined ||
      point === 9 ||
      point === 10 ||
      point === 13 ||
      (point >= 32 && (point < 127 || point > 159))
    ) {
      safe += character;
    }
  }
  return safe;
}

const writeStdout = (value: string): void => {
  process.stdout.write(sanitizeTerminalText(value));
};

const writeStderr = (value: string): void => {
  process.stderr.write(sanitizeTerminalText(value));
};
