/** Pure provider/model filtering; the terminal picker stays at the CLI boundary. */

import { Effect, Schema } from "effect";
import type { AuthorLoginMethod, AuthorModel } from "./author.js";

export class NoProviderAuthenticated extends Schema.TaggedErrorClass<NoProviderAuthenticated>()(
  "NoProviderAuthenticated",
  { requested: Schema.String },
) {}

export function matchingModels(
  models: readonly AuthorModel[],
  provider: string | undefined,
  model: string | undefined,
): readonly AuthorModel[] {
  return models.filter(
    (candidate) =>
      (provider === undefined || candidate.providerId === provider) &&
      (model === undefined || candidate.modelId === model),
  );
}

export function requireScriptedModel(
  models: readonly AuthorModel[],
  provider: string,
  model: string,
): Effect.Effect<AuthorModel, NoProviderAuthenticated> {
  const found = matchingModels(models, provider, model)[0];
  return found === undefined
    ? Effect.fail(new NoProviderAuthenticated({ requested: `${provider}/${model}` }))
    : Effect.succeed(found);
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
