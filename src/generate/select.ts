/** Pure provider/model filtering; the terminal picker stays at the CLI boundary. */

import { Option, Schema } from "effect";
import type { AuthorLoginMethod, AuthorModel, AuthorModelPreference } from "./author.js";

export class NoProviderAuthenticated extends Schema.TaggedErrorClass<NoProviderAuthenticated>()(
  "NoProviderAuthenticated",
  { requested: Schema.String },
) {}

export interface ModelFilter {
  readonly providerId?: string;
  readonly modelId?: string;
}

export type ModelSelection =
  | { readonly _tag: "UsePreference" }
  | { readonly _tag: "Choose"; readonly filter: ModelFilter };

export function modelSelectionFromFlags(
  provider: Option.Option<string>,
  model: Option.Option<string>,
): ModelSelection {
  if (Option.isNone(provider) && Option.isNone(model)) return { _tag: "UsePreference" };
  const providerId = normalizedFlag(provider);
  const modelId = normalizedFlag(model);
  return {
    _tag: "Choose",
    filter: {
      ...(providerId === undefined ? {} : { providerId }),
      ...(modelId === undefined ? {} : { modelId }),
    },
  };
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

export function modelsForPicker(
  models: readonly AuthorModel[],
  filter: ModelFilter,
): { readonly models: readonly AuthorModel[]; readonly usedFallback: boolean } {
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

function normalizedFlag(value: Option.Option<string>): string | undefined {
  if (Option.isNone(value)) return undefined;
  const trimmed = value.value.trim();
  return trimmed === "" ? undefined : trimmed;
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

function loginRank(method: AuthorLoginMethod): number {
  if (method.providerId === "anthropic" && method.method === "oauth") return 0;
  if (method.providerId === "openai-codex" && method.method === "oauth") return 1;
  if (method.providerId === "anthropic" && method.method === "api_key") return 2;
  if (method.providerId === "openai" && method.method === "api_key") return 3;
  return 4;
}

export function noProviderMessage(error: NoProviderAuthenticated): string {
  return (
    `No authenticated Pi model matches ${error.requested}. ` +
    "Run `balade generate <pr>` interactively to log in, or authenticate with the pi CLI first."
  );
}
