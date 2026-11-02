/** The standalone app supplies the same promise host interface as an embedding application. */
import { Effect, Option } from "effect";
import type { Payload } from "../contract";
import {
  ClarificationAgentUnavailable,
  ClarificationGenerationChanged,
  type WalkthroughHost,
} from "../host";
import { ReviewStateFallback, HostOperationFailed } from "./host";
import { askQa, fetchQa, fetchQaAgentStatus } from "./qa";
import { appRuntime } from "./runtime";
import { loadReview, saveReview, type ReviewStoreTarget } from "./store";

export function createAppHost(payload: Payload, served: boolean): WalkthroughHost {
  const storageKey = `balade:${payload.pr.url}#${payload.pr.number}:${payload.sourcePath}`;
  const target: ReviewStoreTarget = served
    ? { mode: "served", storageKey, sourcePath: payload.sourcePath }
    : { mode: "export", storageKey };
  const reviewState: NonNullable<WalkthroughHost["reviewState"]> = {
    load: (signal) =>
      appRuntime.runPromise(loadReview(target).pipe(Effect.map(Option.getOrNull)), { signal }),
    save: async (state, signal) => {
      const outcome = await appRuntime.runPromise(saveReview(target, state), { signal });
      if (outcome === "fallback") throw new ReviewStateFallback();
      if (outcome === "failed") throw new HostOperationFailed({ cause: "review save failed" });
    },
  };
  if (!served) return { reviewState };
  return {
    reviewState,
    clarifications: {
      load: (signal) => appRuntime.runPromise(fetchQa(payload.sourcePath), { signal }),
      status: (signal) => appRuntime.runPromise(fetchQaAgentStatus(), { signal }),
      ask: async (request, signal) => {
        const result = await appRuntime.runPromise(
          askQa(payload.sourcePath, request).pipe(Effect.result),
          { signal },
        );
        if (result._tag === "Success") return result.success;
        if (result.failure._tag === "QaAgentUnavailable") throw new ClarificationAgentUnavailable();
        if (result.failure._tag === "QaGenerationChanged")
          throw new ClarificationGenerationChanged();
        throw result.failure;
      },
    },
  };
}
