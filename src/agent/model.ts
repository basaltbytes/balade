/** Provider/model configuration shared by generation, live Q&A, and the setup command. */

import { Context, Effect, Option, Schema, Semaphore } from "effect";
import {
  AuthorModel as AuthorModelSchema,
  type AuthorLoginMethod,
  type AuthorModel,
  type AuthorModelPreference,
  type AuthorPreferenceReadFailed,
  type LoginInteraction,
  type AuthorDiscoveryFailed,
  type LoginCancelled,
  type LoginFailed,
  type WalkthroughAuthorPort,
} from "../pi/author.js";

export class NoProviderAuthenticated extends Schema.TaggedErrorClass<NoProviderAuthenticated>()(
  "NoProviderAuthenticated",
  { requested: Schema.String },
) {}

export class AgentModelSelectionCancelled extends Schema.TaggedErrorClass<AgentModelSelectionCancelled>()(
  "AgentModelSelectionCancelled",
  {},
) {}

export class AgentModelReady extends Schema.TaggedClass<AgentModelReady>()("AgentModelReady", {
  model: AuthorModelSchema,
}) {}

export class AgentModelSetupRequired extends Schema.TaggedClass<AgentModelSetupRequired>()(
  "AgentModelSetupRequired",
  {},
) {}

export type AgentModelState = AgentModelReady | AgentModelSetupRequired;

export interface ModelFilter {
  readonly providerId?: string;
  readonly modelId?: string;
}

export type ModelSelection =
  | { readonly _tag: "UsePreference" }
  | { readonly _tag: "Choose"; readonly filter: ModelFilter };

export type AgentModelNotice =
  | { readonly _tag: "SetupRequired" }
  | { readonly _tag: "PreferenceReadFailed" }
  | { readonly _tag: "PreferenceWriteFailed" }
  | { readonly _tag: "RequestedModelUnavailable"; readonly requested: string };

export interface AgentModelInteraction {
  readonly chooseLogin: (
    methods: readonly AuthorLoginMethod[],
  ) => Effect.Effect<AuthorLoginMethod, AgentModelSelectionCancelled>;
  readonly chooseModel: (
    models: readonly AuthorModel[],
  ) => Effect.Effect<AuthorModel, AgentModelSelectionCancelled>;
  readonly login: LoginInteraction;
  readonly waiting: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  readonly notice: (notice: AgentModelNotice) => Effect.Effect<void>;
  readonly selected: (model: AuthorModel, source: "chosen" | "saved") => Effect.Effect<void>;
}

export type AgentModelStatusError = AuthorDiscoveryFailed | AuthorPreferenceReadFailed;

export type AgentModelConfigurationError =
  | AuthorDiscoveryFailed
  | LoginFailed
  | LoginCancelled
  | NoProviderAuthenticated
  | AgentModelSelectionCancelled;

export interface AgentModelManagerPort {
  readonly status: Effect.Effect<AgentModelState, AgentModelStatusError>;
  readonly ensure: Effect.Effect<AuthorModel, AgentModelConfigurationError>;
  readonly configure: (
    selection: ModelSelection,
  ) => Effect.Effect<AuthorModel, AgentModelConfigurationError>;
}

export class AgentModelManager extends Context.Service<AgentModelManager, AgentModelManagerPort>()(
  "@balade/AgentModelManager",
) {}

export function modelSelectionFromFlags(
  provider: Option.Option<string>,
  model: Option.Option<string>,
): ModelSelection {
  if (Option.isNone(provider) && Option.isNone(model)) return { _tag: "UsePreference" };
  const providerId = normalizedFlag(provider);
  const modelId = normalizedFlag(model);
  return { _tag: "Choose", filter: modelFilter(providerId, modelId) };
}

export function matchingModels(
  models: readonly AuthorModel[],
  filter: ModelFilter,
): readonly AuthorModel[] {
  return models.filter(
    (candidate) =>
      (filter.providerId === undefined || candidate.providerId === filter.providerId) &&
      (filter.modelId === undefined || candidate.modelId === filter.modelId),
  );
}

export interface PickerModels {
  readonly models: readonly AuthorModel[];
  readonly usedFallback: boolean;
}

export function modelsForPicker(models: readonly AuthorModel[], filter: ModelFilter): PickerModels {
  const exact = matchingModels(models, filter);
  if (exact.length > 0) return { models: exact, usedFallback: false };

  if (filter.providerId !== undefined) {
    const sameProvider = matchingModels(models, { providerId: filter.providerId });
    if (sameProvider.length > 0) return { models: sameProvider, usedFallback: true };
  }
  if (filter.modelId !== undefined) {
    const sameModel = matchingModels(models, { modelId: filter.modelId });
    if (sameModel.length > 0) return { models: sameModel, usedFallback: true };
  }
  return {
    models,
    usedFallback: filter.providerId !== undefined || filter.modelId !== undefined,
  };
}

export function preferredModel(
  models: readonly AuthorModel[],
  preference: Option.Option<AuthorModelPreference>,
): Option.Option<AuthorModel> {
  if (Option.isNone(preference)) return Option.none();
  return Option.fromNullishOr(
    models.find(
      (candidate) =>
        candidate.providerId === preference.value.providerId &&
        candidate.modelId === preference.value.modelId,
    ),
  );
}

/** Product-preferred first-run paths; everything else remains available after them. */
export function orderedLoginMethods(
  methods: readonly AuthorLoginMethod[],
  provider: string | undefined,
): readonly AuthorLoginMethod[] {
  return methods
    .filter((method) => provider === undefined || method.providerId === provider)
    .toSorted(
      (left, right) => loginRank(left) - loginRank(right) || left.label.localeCompare(right.label),
    );
}

export const readAgentModelState = Effect.fn("readAgentModelState")(function* (
  author: WalkthroughAuthorPort,
) {
  const preference = yield* author.modelPreference;
  if (Option.isNone(preference)) return new AgentModelSetupRequired();
  const available = yield* author.availableModels;
  const selected = preferredModel(available, preference);
  return Option.isSome(selected)
    ? new AgentModelReady({ model: selected.value })
    : new AgentModelSetupRequired();
});

export const makeAgentModelManager = Effect.fn("makeAgentModelManager")(function* (
  author: WalkthroughAuthorPort,
  interaction: AgentModelInteraction,
) {
  const lock = yield* Semaphore.make(1);
  const configure = Effect.fn("AgentModelManager.configure")((selection: ModelSelection) =>
    configureAgentModel(author, selection, interaction),
  );
  return {
    status: readAgentModelState(author),
    ensure: lock.withPermit(
      readAgentModelState(author).pipe(
        Effect.catchTag("AuthorPreferenceReadFailed", () =>
          Effect.succeed(new AgentModelSetupRequired()),
        ),
        Effect.flatMap((state) =>
          state._tag === "AgentModelReady"
            ? Effect.succeed(state.model)
            : interaction
                .notice({ _tag: "SetupRequired" })
                .pipe(Effect.andThen(configure({ _tag: "UsePreference" }))),
        ),
      ),
    ),
    configure: (selection) => lock.withPermit(configure(selection)),
  } satisfies AgentModelManagerPort;
});

const configureAgentModel = Effect.fn("configureAgentModel")(function* (
  author: WalkthroughAuthorPort,
  selection: ModelSelection,
  interaction: AgentModelInteraction,
) {
  const rememberSelected = (selected: AuthorModel) =>
    author
      .rememberModel(selected)
      .pipe(
        Effect.catchTag("AuthorPreferenceWriteFailed", () =>
          interaction.notice({ _tag: "PreferenceWriteFailed" }),
        ),
      );
  let available = yield* author.availableModels;
  const filter: ModelFilter = selection._tag === "Choose" ? selection.filter : {};
  if (filter.providerId !== undefined && filter.modelId !== undefined) {
    const selected = matchingModels(available, filter)[0];
    if (selected !== undefined) {
      yield* rememberSelected(selected);
      yield* interaction.selected(selected, "chosen");
      return selected;
    }
  }

  if (selection._tag === "UsePreference") {
    const preference = yield* author.modelPreference.pipe(
      Effect.catchTag("AuthorPreferenceReadFailed", () =>
        interaction
          .notice({ _tag: "PreferenceReadFailed" })
          .pipe(Effect.as(Option.none<AuthorModelPreference>())),
      ),
    );
    const saved = preferredModel(available, preference);
    if (Option.isSome(saved)) {
      yield* interaction.selected(saved.value, "saved");
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
    const method = yield* interaction.waiting(interaction.chooseLogin(methods));
    yield* interaction.waiting(author.login(method, interaction.login));
    available = yield* author.availableModels;
  } else if (available.length === 0) {
    return yield* new NoProviderAuthenticated({ requested: requestedModel(filter) });
  }

  const picker = modelsForPicker(available, filter);
  if (picker.models.length === 0) {
    return yield* new NoProviderAuthenticated({ requested: requestedModel(filter) });
  }
  if (picker.usedFallback) {
    yield* interaction.notice({
      _tag: "RequestedModelUnavailable",
      requested: requestedModel(filter),
    });
  }

  const selected = yield* interaction.waiting(interaction.chooseModel(picker.models));
  yield* rememberSelected(selected);
  yield* interaction.selected(selected, "chosen");
  return selected;
});

function normalizedFlag(value: Option.Option<string>): string | undefined {
  if (Option.isNone(value)) return undefined;
  const trimmed = value.value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function modelFilter(providerId: string | undefined, modelId: string | undefined): ModelFilter {
  if (providerId === undefined) return modelId === undefined ? {} : { modelId };
  if (modelId === undefined) return { providerId };
  return { providerId, modelId };
}

function loginRank(method: AuthorLoginMethod): number {
  if (method.providerId === "anthropic" && method.method === "oauth") return 0;
  if (method.providerId === "openai-codex" && method.method === "oauth") return 1;
  if (method.providerId === "anthropic" && method.method === "api_key") return 2;
  if (method.providerId === "openai" && method.method === "api_key") return 3;
  return 4;
}

function requestedModel(filter: ModelFilter): string {
  return `${filter.providerId ?? "any provider"}/${filter.modelId ?? "any model"}`;
}
