/** Pi 0.83 adapter. The package is loaded only when a generation method runs. */

import type { AgentSession, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import {
  Context,
  Effect,
  Layer,
  Option,
  Redacted,
  Result,
  Schema,
  Semaphore,
  Terminal,
} from "effect";
import { describeFailure } from "../failure.js";
import { CommandExecutor } from "../resolve/exec.js";
import {
  AuthorDiscoveryFailed,
  AuthorDraft,
  AuthorLoginMethod,
  AuthorModel,
  AuthorModelPreference,
  AuthorPreferenceReadFailed,
  AuthorPreferenceWriteFailed,
  AuthorSessionStartFailed,
  AuthorUsage,
  DraftMalformed,
  LoginCancelled,
  LoginFailed,
  ProviderRequestFailed,
  WalkthroughAuthor,
  type AuthoringRequest,
  type AuthoringSession,
  type AuthorLoginMethod as AuthorLoginMethodType,
  type LoginInteraction,
  type LoginNotification,
  type LoginPrompt,
  type LoginSecretPrompt,
} from "./author.js";
import { initialAuthoringPrompt, repairAuthoringPrompt } from "./prompt.js";
import { createPiSession, releasePiSession, type PiSessionDependencies } from "./pi-session.js";

export interface PiAdapterDependencies extends PiSessionDependencies {
  readonly settingsManager: SettingsManager;
}

export interface PiWalkthroughAuthorOptions {
  /** Explicit injection keeps adapter tests on Pi's faux provider and in-memory stores. */
  readonly load?: () => Promise<PiAdapterDependencies>;
}

type CommandDependencies = CommandExecutor;

const decodeModels = Schema.decodeUnknownEffect(Schema.Array(AuthorModel), {
  onExcessProperty: "error",
});
const decodeLoginMethods = Schema.decodeUnknownEffect(Schema.Array(AuthorLoginMethod), {
  onExcessProperty: "error",
});
const decodeModelPreference = Schema.decodeUnknownEffect(AuthorModelPreference, {
  onExcessProperty: "error",
});
const decodeDraft = Schema.decodeUnknownEffect(AuthorDraft, { onExcessProperty: "error" });
const decodeUsage = Schema.decodeUnknownEffect(AuthorUsage, { onExcessProperty: "error" });

interface RawLoginMethod {
  readonly providerId: string;
  readonly providerName: string;
  readonly method: "oauth" | "api_key";
  readonly label: string;
  readonly billing: "standard" | "anthropic-extra-usage";
}

async function loadLiveDependencies(): Promise<PiAdapterDependencies> {
  const [coding, ai] = await Promise.all([
    import("@earendil-works/pi-coding-agent"),
    import("@earendil-works/pi-ai"),
  ]);
  return {
    coding,
    ai,
    modelRuntime: await coding.ModelRuntime.create(),
    settingsManager: coding.SettingsManager.create(process.cwd(), undefined, {
      projectTrusted: false,
    }),
  };
}

/** Inert until a method calls `dependencies`; check/open/build never import Pi. */
export function piWalkthroughAuthorLayer(options: PiWalkthroughAuthorOptions = {}) {
  return Layer.effect(
    WalkthroughAuthor,
    Effect.gen(function* () {
      const commandContext = Context.pick(CommandExecutor)(
        yield* Effect.context<CommandDependencies>(),
      );
      const runCommand = Effect.runPromiseWith(commandContext);
      let loaded: Promise<PiAdapterDependencies> | undefined;
      let settingsFailure: Error | undefined;
      const load = options.load ?? loadLiveDependencies;
      const dependencies = () => (loaded ??= load());

      const availableModels = Effect.gen(function* () {
        const raw = yield* Effect.tryPromise({
          try: async () => {
            const { modelRuntime } = await dependencies();
            const models = await modelRuntime.getAvailable();
            return models
              .map((model) => {
                const provider = modelRuntime.getProvider(model.provider);
                return {
                  providerId: model.provider,
                  providerName: provider?.name ?? model.provider,
                  modelId: model.id,
                  modelName: model.name,
                };
              })
              .sort((left, right) =>
                `${left.providerName}/${left.modelName}`.localeCompare(
                  `${right.providerName}/${right.modelName}`,
                ),
              );
          },
          catch: (cause) => new AuthorDiscoveryFailed({ cause }),
        });
        return yield* decodeModels(raw).pipe(
          Effect.mapError((cause) => new AuthorDiscoveryFailed({ cause })),
        );
      }).pipe(Effect.withSpan("WalkthroughAuthor.availableModels"));

      const modelPreference = Effect.tryPromise({
        try: async () => {
          const { settingsManager } = await dependencies();
          await settingsManager.flush();
          const failure = firstSettingsError(settingsManager);
          if (failure !== undefined) {
            settingsFailure = failure;
            throw failure;
          }
          const providerId = settingsManager.getDefaultProvider();
          const modelId = settingsManager.getDefaultModel();
          return providerId === undefined || modelId === undefined
            ? Option.none()
            : Option.some({ providerId, modelId });
        },
        catch: (cause) => new AuthorPreferenceReadFailed({ cause }),
      }).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.succeed(Option.none()),
            onSome: (preference) =>
              decodeModelPreference(preference).pipe(
                Effect.map(Option.some),
                Effect.mapError((cause) => new AuthorPreferenceReadFailed({ cause })),
              ),
          }),
        ),
        Effect.withSpan("WalkthroughAuthor.modelPreference"),
      );

      const rememberModel = Effect.fn("WalkthroughAuthor.rememberModel")((model: AuthorModel) =>
        Effect.tryPromise({
          try: async () => {
            const { settingsManager } = await dependencies();
            if (settingsFailure !== undefined) throw settingsFailure;
            settingsManager.setDefaultModelAndProvider(model.providerId, model.modelId);
            await settingsManager.flush();
            const failure = firstSettingsError(settingsManager);
            if (failure !== undefined) {
              settingsFailure = failure;
              throw failure;
            }
          },
          catch: (cause) => new AuthorPreferenceWriteFailed({ cause }),
        }),
      );

      const loginMethods = Effect.gen(function* () {
        const raw = yield* Effect.tryPromise({
          try: async () => {
            const { modelRuntime } = await dependencies();
            return modelRuntime.getProviders().flatMap((provider) => {
              const methods: RawLoginMethod[] = [];
              if (provider.auth.oauth !== undefined) {
                methods.push({
                  providerId: provider.id,
                  providerName: provider.name,
                  method: "oauth",
                  label: provider.auth.oauth.name,
                  billing: provider.id === "anthropic" ? "anthropic-extra-usage" : "standard",
                });
              }
              if (provider.auth.apiKey?.login !== undefined) {
                methods.push({
                  providerId: provider.id,
                  providerName: provider.name,
                  method: "api_key",
                  label: provider.auth.apiKey.name,
                  billing: "standard",
                });
              }
              return methods;
            });
          },
          catch: (cause) => new AuthorDiscoveryFailed({ cause }),
        });
        const methods = yield* decodeLoginMethods(raw).pipe(
          Effect.mapError((cause) => new AuthorDiscoveryFailed({ cause })),
        );
        return [...methods].sort((left, right) =>
          `${left.providerName}/${left.method}`.localeCompare(
            `${right.providerName}/${right.method}`,
          ),
        );
      }).pipe(Effect.withSpan("WalkthroughAuthor.loginMethods"));

      const login = Effect.fn("WalkthroughAuthor.login")(function* (
        method: AuthorLoginMethodType,
        interaction: LoginInteraction,
      ) {
        return yield* Effect.tryPromise({
          try: async (signal) => {
            const { modelRuntime } = await dependencies();
            await modelRuntime.login(method.providerId, method.method, {
              signal,
              prompt: async (prompt) => {
                const mapped = mapLoginPrompt(prompt);
                return mapped.type === "secret"
                  ? Redacted.value(await interaction.secret(mapped))
                  : interaction.prompt(mapped);
              },
              notify: (event) => interaction.notify(mapLoginNotification(event)),
            });
          },
          catch: (cause) =>
            Terminal.isQuitError(cause)
              ? new LoginCancelled()
              : new LoginFailed({
                  provider: method.providerId,
                  method: method.method,
                  reason: modelsErrorCode(cause),
                }),
        });
      });

      const start = Effect.fn("WalkthroughAuthor.start")(function* (request: AuthoringRequest) {
        const acquired = yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: async () => {
              const pi = await dependencies();
              const model = pi.modelRuntime.getModel(
                request.model.providerId,
                request.model.modelId,
              );
              if (model === undefined) {
                throw new Error(
                  `Model ${request.model.providerId}/${request.model.modelId} is no longer available.`,
                );
              }
              return createPiSession(pi, model, request, runCommand);
            },
            catch: (cause) =>
              new AuthorSessionStartFailed({
                provider: request.model.providerId,
                model: request.model.modelId,
                cause,
              }),
          }),
          ({ session, unsubscribe }) =>
            Effect.gen(function* () {
              unsubscribe();
              yield* releasePiSession(session);
            }),
        );
        const semaphore = yield* Semaphore.make(1);

        const turn = Effect.fn("PiAuthoringSession.turn")((invoke: () => Promise<void>) =>
          semaphore.withPermit(
            Effect.gen(function* () {
              acquired.clearDraft();
              acquired.resetInspectionBudget();
              const invocation = yield* Effect.result(
                Effect.tryPromise({
                  try: invoke,
                  catch: (cause) =>
                    new ProviderRequestFailed({
                      provider: request.model.providerId,
                      model: request.model.modelId,
                      detail: describeFailure(cause),
                    }),
                }),
              );

              const usage = yield* readUsage(acquired.session);
              request.progress({ _tag: "AuthorUsageUpdated", usage });

              if (Result.isFailure(invocation)) return yield* invocation.failure;

              const providerError = acquired.session.state.errorMessage;
              if (providerError !== undefined && providerError !== "") {
                return yield* new ProviderRequestFailed({
                  provider: request.model.providerId,
                  model: request.model.modelId,
                  detail: providerError,
                });
              }

              const rawDraft = acquired.getDraft();
              if (rawDraft === undefined) {
                return yield* new DraftMalformed({
                  detail: "The authoring agent finished without calling submit_walkthrough.",
                });
              }
              const draft = yield* decodeDraft(rawDraft).pipe(
                Effect.mapError(
                  () =>
                    new DraftMalformed({
                      detail: "The submitted walkthrough did not match the authoring contract.",
                    }),
                ),
              );
              if (hasEnvelopeOrFence(draft.body)) {
                return yield* new DraftMalformed({
                  detail: "The submitted body must not contain frontmatter or an outer code fence.",
                });
              }
              return { draft, usage };
            }),
          ),
        );

        const initial = yield* turn(() => acquired.session.prompt(initialAuthoringPrompt(request)));

        return {
          initial,
          repair: Effect.fn("PiAuthoringSession.repair")((feedback: string) =>
            turn(() => acquired.session.prompt(repairAuthoringPrompt(feedback))),
          ),
        } satisfies AuthoringSession;
      });

      return { availableModels, modelPreference, rememberModel, loginMethods, login, start };
    }),
  );
}

function firstSettingsError(settingsManager: SettingsManager): Error | undefined {
  return settingsManager.drainErrors()[0]?.error;
}

function mapLoginPrompt(prompt: AuthPrompt): LoginPrompt | LoginSecretPrompt {
  const signal = prompt.signal === undefined ? {} : { signal: prompt.signal };
  if (prompt.type === "select") {
    return {
      type: "select",
      message: prompt.message,
      options: prompt.options.map((option) => ({
        id: option.id,
        label: option.label,
        ...(option.description === undefined ? {} : { description: option.description }),
      })),
      ...signal,
    };
  }
  return {
    type: prompt.type,
    message: prompt.message,
    ...(prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder }),
    ...signal,
  };
}

function mapLoginNotification(event: AuthEvent): LoginNotification {
  switch (event.type) {
    case "info":
      return {
        type: "info",
        message: event.message,
        links: (event.links ?? []).map((link) => ({
          url: link.url,
          ...(link.label === undefined ? {} : { label: link.label }),
        })),
      };
    case "auth_url":
      return {
        type: "auth_url",
        url: event.url,
        ...(event.instructions === undefined ? {} : { instructions: event.instructions }),
      };
    case "device_code":
      return {
        type: "device_code",
        userCode: event.userCode,
        verificationUri: event.verificationUri,
        ...(event.intervalSeconds === undefined ? {} : { intervalSeconds: event.intervalSeconds }),
        ...(event.expiresInSeconds === undefined
          ? {}
          : { expiresInSeconds: event.expiresInSeconds }),
      };
    case "progress":
      return { type: "progress", message: event.message };
  }
}

function modelsErrorCode(cause: unknown): "oauth" | "auth" | "provider" | "unknown" {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return "unknown";
  const code = cause.code;
  return code === "oauth" || code === "auth" || code === "provider" ? code : "unknown";
}

function hasEnvelopeOrFence(body: string): boolean {
  const trimmed = body.trimStart();
  return trimmed.startsWith("---") || trimmed.startsWith("```");
}

const readUsage = Effect.fn("PiAuthoringSession.readUsage")(function* (session: AgentSession) {
  const stats = session.getSessionStats();
  return yield* decodeUsage({
    input: stats.tokens.input,
    output: stats.tokens.output,
    cacheRead: stats.tokens.cacheRead,
    cacheWrite: stats.tokens.cacheWrite,
    total: stats.tokens.total,
    cost: stats.cost,
  }).pipe(
    Effect.mapError(() => new DraftMalformed({ detail: "Pi returned malformed usage totals." })),
  );
});

export const piWalkthroughAuthorLive = piWalkthroughAuthorLayer();
