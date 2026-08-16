/** Balade-owned model setup policy through injected author and interaction ports. */

import { Effect, Option, Redacted, Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import {
  AgentModelSelectionCancelled,
  makeAgentModelManager,
  matchingModels,
  modelSelectionFromFlags,
  modelsForPicker,
  NoProviderAuthenticated,
  orderedLoginMethods,
  preferredModel,
  type AgentModelInteraction,
  type AgentModelNotice,
} from "../src/agent/model.js";
import {
  AuthorLoginMethod as AuthorLoginMethodSchema,
  AuthorModel as AuthorModelSchema,
  AuthorPreferenceReadFailed,
  AuthorPreferenceWriteFailed,
  LoginCancelled,
  type AuthorLoginMethod,
  type AuthorModel,
  type AuthorModelPreference,
  type WalkthroughAuthorPort,
} from "../src/pi/author.js";

const first = Schema.decodeUnknownSync(AuthorModelSchema)({
  providerId: "faux",
  providerName: "Faux",
  modelId: "one",
  modelName: "One",
});

const second = Schema.decodeUnknownSync(AuthorModelSchema)({
  providerId: "other",
  providerName: "Other",
  modelId: "two",
  modelName: "Two",
});

const fauxLogin = Schema.decodeUnknownSync(AuthorLoginMethodSchema)({
  providerId: "faux",
  providerName: "Faux",
  method: "api_key",
  label: "Faux API key",
  billing: "standard",
});

interface AuthorFixtureOptions {
  readonly availableModels: () => readonly AuthorModel[];
  readonly modelPreference?: WalkthroughAuthorPort["modelPreference"];
  readonly rememberModel?: WalkthroughAuthorPort["rememberModel"];
  readonly loginMethods?: WalkthroughAuthorPort["loginMethods"];
  readonly login?: WalkthroughAuthorPort["login"];
}

function makeAuthor(options: AuthorFixtureOptions): WalkthroughAuthorPort {
  return {
    availableModels: Effect.sync(options.availableModels),
    modelPreference:
      options.modelPreference ?? Effect.succeed(Option.none<AuthorModelPreference>()),
    rememberModel: options.rememberModel ?? (() => Effect.void),
    loginMethods: options.loginMethods ?? Effect.succeed([]),
    login: options.login ?? (() => Effect.void),
    start: () => Effect.die("authoring is outside this fixture"),
  };
}

interface InteractionFixtureOptions {
  readonly chooseLogin?: AgentModelInteraction["chooseLogin"];
  readonly chooseModel?: AgentModelInteraction["chooseModel"];
}

function makeInteraction(options: InteractionFixtureOptions = {}) {
  const loginChoices: (readonly AuthorLoginMethod[])[] = [];
  const modelChoices: (readonly AuthorModel[])[] = [];
  const notices: AgentModelNotice[] = [];
  const selected: Array<{ readonly model: AuthorModel; readonly source: "chosen" | "saved" }> = [];
  const interaction: AgentModelInteraction = {
    chooseLogin: (methods) => {
      loginChoices.push(methods);
      const fallback = methods[0];
      return (
        options.chooseLogin?.(methods) ??
        (fallback === undefined ? Effect.die("login picker was empty") : Effect.succeed(fallback))
      );
    },
    chooseModel: (models) => {
      modelChoices.push(models);
      const fallback = models[0];
      return (
        options.chooseModel?.(models) ??
        (fallback === undefined ? Effect.die("model picker was empty") : Effect.succeed(fallback))
      );
    },
    login: {
      prompt: async () => "",
      secret: async () => Redacted.make("fixture"),
      notify: () => {},
    },
    waiting: (effect) => effect,
    notice: (notice) => Effect.sync(() => notices.push(notice)),
    selected: (model, source) => Effect.sync(() => selected.push({ model, source })),
  };
  return { interaction, loginChoices, modelChoices, notices, selected };
}

describe("agent model selection", () => {
  it("derives filters, preferences, and progressively broader picker candidates", () => {
    const models = [first, second];
    expect(matchingModels(models, { providerId: "missing" })).toEqual([]);
    expect(
      Option.getOrUndefined(
        preferredModel(
          models,
          Option.some({ providerId: first.providerId, modelId: first.modelId }),
        ),
      ),
    ).toEqual(first);
    expect(modelSelectionFromFlags(Option.none(), Option.none())).toEqual({
      _tag: "UsePreference",
    });
    expect(modelSelectionFromFlags(Option.some("  faux  "), Option.some(""))).toEqual({
      _tag: "Choose",
      filter: { providerId: "faux" },
    });
    expect(modelSelectionFromFlags(Option.some(""), Option.none())).toEqual({
      _tag: "Choose",
      filter: {},
    });
    expect(modelsForPicker(models, { providerId: "faux", modelId: "missing" })).toEqual({
      models: [first],
      usedFallback: true,
    });
    expect(modelsForPicker(models, { providerId: "missing", modelId: "two" })).toEqual({
      models: [second],
      usedFallback: true,
    });
    expect(modelsForPicker(models, { providerId: "missing", modelId: "absent" })).toEqual({
      models,
      usedFallback: true,
    });
  });

  it("orders preferred login paths while preserving every method", () => {
    const methods = [
      Schema.decodeUnknownSync(AuthorLoginMethodSchema)({
        providerId: "other",
        providerName: "Other",
        method: "api_key",
        label: "Other API key",
        billing: "standard",
      }),
      Schema.decodeUnknownSync(AuthorLoginMethodSchema)({
        providerId: "openai-codex",
        providerName: "OpenAI Codex",
        method: "oauth",
        label: "OpenAI Codex login",
        billing: "standard",
      }),
      Schema.decodeUnknownSync(AuthorLoginMethodSchema)({
        providerId: "anthropic",
        providerName: "Anthropic",
        method: "oauth",
        label: "Anthropic login",
        billing: "standard",
      }),
    ];

    expect(orderedLoginMethods(methods, undefined)).toEqual([methods[2], methods[1], methods[0]]);
    expect(orderedLoginMethods(methods, "other")).toEqual([methods[0]]);
  });

  it.effect("reuses an available saved preference without opening setup", () =>
    Effect.gen(function* () {
      const remembered: AuthorModel[] = [];
      const fixture = makeInteraction();
      const manager = yield* makeAgentModelManager(
        makeAuthor({
          availableModels: () => [first, second],
          modelPreference: Effect.succeed(
            Option.some({ providerId: second.providerId, modelId: second.modelId }),
          ),
          rememberModel: (model) => Effect.sync(() => remembered.push(model)),
        }),
        fixture.interaction,
      );

      expect(yield* manager.ensure).toEqual(second);
      expect(fixture.loginChoices).toEqual([]);
      expect(fixture.modelChoices).toEqual([]);
      expect(fixture.notices).toEqual([]);
      expect(remembered).toEqual([]);
    }),
  );

  it.effect("selects an available explicit model without opening a picker", () =>
    Effect.gen(function* () {
      const remembered: AuthorModel[] = [];
      const fixture = makeInteraction();
      const manager = yield* makeAgentModelManager(
        makeAuthor({
          availableModels: () => [first, second],
          rememberModel: (model) => Effect.sync(() => remembered.push(model)),
        }),
        fixture.interaction,
      );

      expect(
        yield* manager.configure({
          _tag: "Choose",
          filter: { providerId: second.providerId, modelId: second.modelId },
        }),
      ).toEqual(second);
      expect(fixture.loginChoices).toEqual([]);
      expect(fixture.modelChoices).toEqual([]);
      expect(remembered).toEqual([second]);
      expect(fixture.selected).toEqual([{ model: second, source: "chosen" }]);
    }),
  );

  it.effect("invokes the chosen login method, refreshes models, and remembers the result", () =>
    Effect.gen(function* () {
      let available: readonly AuthorModel[] = [];
      const loggedIn: AuthorLoginMethod[] = [];
      const remembered: AuthorModel[] = [];
      const fixture = makeInteraction();
      const manager = yield* makeAgentModelManager(
        makeAuthor({
          availableModels: () => available,
          loginMethods: Effect.succeed([fauxLogin]),
          login: (method) =>
            Effect.sync(() => {
              loggedIn.push(method);
              available = [first];
            }),
          rememberModel: (model) => Effect.sync(() => remembered.push(model)),
        }),
        fixture.interaction,
      );

      expect(yield* manager.configure({ _tag: "UsePreference" })).toEqual(first);
      expect(fixture.loginChoices).toEqual([[fauxLogin]]);
      expect(loggedIn).toEqual([fauxLogin]);
      expect(fixture.modelChoices).toEqual([[first]]);
      expect(remembered).toEqual([first]);
    }),
  );

  it.effect("reports when no model or login method is available", () =>
    Effect.gen(function* () {
      const manager = yield* makeAgentModelManager(
        makeAuthor({ availableModels: () => [] }),
        makeInteraction().interaction,
      );

      const error = yield* Effect.flip(manager.configure({ _tag: "UsePreference" }));
      expect(error).toEqual(new NoProviderAuthenticated({ requested: "any provider/any model" }));
    }),
  );

  it.effect("warns on preference I/O failures and still returns the selected model", () =>
    Effect.gen(function* () {
      const fixture = makeInteraction();
      const manager = yield* makeAgentModelManager(
        makeAuthor({
          availableModels: () => [first],
          modelPreference: new AuthorPreferenceReadFailed({ cause: "read failed" }),
          rememberModel: () => new AuthorPreferenceWriteFailed({ cause: "write failed" }),
        }),
        fixture.interaction,
      );

      expect(yield* manager.configure({ _tag: "UsePreference" })).toEqual(first);
      expect(fixture.notices).toEqual([
        { _tag: "PreferenceReadFailed" },
        { _tag: "PreferenceWriteFailed" },
      ]);
      expect(fixture.selected).toEqual([{ model: first, source: "chosen" }]);
    }),
  );

  it.effect("explains an unavailable request before offering fallback candidates", () =>
    Effect.gen(function* () {
      const fixture = makeInteraction();
      const manager = yield* makeAgentModelManager(
        makeAuthor({ availableModels: () => [first, second] }),
        fixture.interaction,
      );

      expect(
        yield* manager.configure({
          _tag: "Choose",
          filter: { providerId: "missing", modelId: second.modelId },
        }),
      ).toEqual(second);
      expect(fixture.modelChoices).toEqual([[second]]);
      expect(fixture.notices).toEqual([
        { _tag: "RequestedModelUnavailable", requested: "missing/two" },
      ]);
    }),
  );

  it.effect("preserves typed setup cancellation from picker and author ports", () =>
    Effect.gen(function* () {
      const pickerCancelled = makeInteraction({
        chooseModel: () => new AgentModelSelectionCancelled(),
      });
      const pickerManager = yield* makeAgentModelManager(
        makeAuthor({ availableModels: () => [first] }),
        pickerCancelled.interaction,
      );
      expect(yield* Effect.flip(pickerManager.configure({ _tag: "UsePreference" }))).toEqual(
        new AgentModelSelectionCancelled(),
      );

      const loginManager = yield* makeAgentModelManager(
        makeAuthor({
          availableModels: () => [],
          loginMethods: Effect.succeed([fauxLogin]),
          login: () => new LoginCancelled(),
        }),
        makeInteraction().interaction,
      );
      expect(yield* Effect.flip(loginManager.configure({ _tag: "UsePreference" }))).toEqual(
        new LoginCancelled(),
      );
    }),
  );
});
