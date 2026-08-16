/** Terminal interaction for the shared agent model configuration workflow. */

import { Context, Effect, Layer } from "effect";
import { Prompt } from "effect/unstable/cli";
import { AgentPresence, reportWaitingDuring } from "../presence.js";
import {
  type AuthorModel,
  type LoginInteraction,
  type LoginNotification,
  type LoginPrompt,
  type LoginSecretPrompt,
  WalkthroughAuthor,
} from "../pi/author.js";
import {
  sanitizeTerminalText,
  stderrTheme,
  stdoutTheme,
  writeStderr,
  writeStdout,
} from "../terminal.js";
import {
  AgentModelManager,
  AgentModelSelectionCancelled,
  makeAgentModelManager,
  type AgentModelInteraction,
  type AgentModelNotice,
} from "./model.js";

type ChoiceDescriptionFacet = { description?: string };

const SETUP_NOTICE =
  "Clarifications need a one-time agent setup. Complete the terminal prompts; the question will be sent automatically afterward.\n";

export const terminalAgentModelManagerLive = Layer.effect(
  AgentModelManager,
  Effect.gen(function* () {
    const author = yield* WalkthroughAuthor;
    const presence = yield* AgentPresence;
    const promptContext = yield* Effect.context<Prompt.Environment>();
    const interaction: AgentModelInteraction = {
      chooseLogin: (methods) =>
        Prompt.run(
          Prompt.select({
            message: "Log in to an agent provider",
            choices: methods.map((candidate) => ({
              title: `${candidate.providerName} — ${candidate.label}`,
              value: candidate,
              description:
                candidate.billing === "anthropic-extra-usage"
                  ? anthropicBillingCaveat()
                  : `${candidate.method === "oauth" ? "Subscription" : "API key"} authentication`,
            })),
          }),
        ).pipe(
          Effect.provide(promptContext),
          Effect.mapError(() => new AgentModelSelectionCancelled()),
          Effect.tap((method) =>
            method.billing === "anthropic-extra-usage"
              ? Effect.sync(() => writeStdout(`${anthropicBillingCaveat()}\n`))
              : Effect.void,
          ),
        ),
      chooseModel: (models) =>
        Prompt.run(
          Prompt.select({
            message: "Choose the provider and model",
            choices: models.map((candidate) => ({
              title: `${candidate.providerName} — ${candidate.modelName}`,
              value: candidate,
              description:
                candidate.providerId === "anthropic"
                  ? anthropicBillingCaveat()
                  : `${candidate.providerId}/${candidate.modelId}`,
            })),
          }),
        ).pipe(
          Effect.provide(promptContext),
          Effect.mapError(() => new AgentModelSelectionCancelled()),
        ),
      login: loginInteraction(promptContext),
      waiting: (effect) =>
        reportWaitingDuring(effect).pipe(Effect.provideService(AgentPresence, presence)),
      notice: terminalNotice,
      selected: (model, source) =>
        Effect.sync(() =>
          announceModel(model, source === "saved" ? "saved preference" : undefined),
        ),
    };
    return yield* makeAgentModelManager(author, interaction);
  }),
);

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

function terminalNotice(notice: AgentModelNotice): Effect.Effect<void> {
  return Effect.sync(() => {
    switch (notice._tag) {
      case "SetupRequired":
        writeStdout(SETUP_NOTICE);
        break;
      case "PreferenceReadFailed":
        writeStderr(
          `${stderrTheme.warning("warning")} The saved agent model could not be read; choose a model.\n`,
        );
        break;
      case "PreferenceWriteFailed":
        writeStderr(
          `${stderrTheme.warning("warning")} The agent model preference could not be saved; this run will continue.\n`,
        );
        break;
      case "RequestedModelUnavailable":
        writeStderr(
          `${stderrTheme.warning("warning")} No available agent model matches ${sanitizeTerminalText(notice.requested)}; choose from the available models.\n`,
        );
        break;
    }
  });
}

function announceModel(model: AuthorModel, source?: string): void {
  writeStdout(
    `Provider/model: ${stdoutTheme.emphasis(`${model.providerName} — ${model.modelName}`)} (${model.providerId}/${model.modelId})${source === undefined ? "" : ` — ${source}`}\n`,
  );
  if (model.providerId === "anthropic") writeStdout(`${anthropicBillingCaveat()}\n`);
}

export function noProviderMessage(requested: string): string {
  return (
    `No authenticated agent model matches ${requested}. ` +
    "Run `balade agent setup` interactively to authenticate and choose one."
  );
}

export function loginErrorMessage(error: import("../pi/author.js").LoginFailed): string {
  switch (error.reason) {
    case "oauth":
      return `The ${error.provider} subscription login did not complete. Retry \`balade agent setup\`.`;
    case "auth":
      return `The ${error.provider} credential was rejected. Check the account or API key and retry \`balade agent setup\`.`;
    case "provider":
      return `The ${error.provider} provider could not start. Check its configuration and retry \`balade agent setup\`.`;
    case "unknown":
      return `The ${error.provider} provider could not authenticate. Retry \`balade agent setup\`.`;
  }
}

export function agentModelErrorMessage(
  error: import("./model.js").AgentModelConfigurationError,
): string {
  switch (error._tag) {
    case "AuthorDiscoveryFailed":
      return "Agent providers and models could not be loaded. Check the installation and try again.";
    case "LoginFailed":
      return loginErrorMessage(error);
    case "LoginCancelled":
    case "AgentModelSelectionCancelled":
      return "Agent setup cancelled.";
    case "NoProviderAuthenticated":
      return noProviderMessage(error.requested);
  }
}

function anthropicBillingCaveat(): string {
  return (
    "Anthropic subscription login in third-party tools is billed per token as extra usage; " +
    "it does not draw on Claude plan limits."
  );
}
