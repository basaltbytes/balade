/** Decode promises at the host boundary before their contents reach any render sink. */
import { Effect, Schema } from "effect";
import {
  parseQaAgentStatus,
  parseQaState,
  type QaStateInvalid,
} from "../../../src/contract/qa-parser";
import { parseReviewState } from "../../../src/contract/review-parser";
import type { Payload, QaAskRequest, QaState, ReviewState } from "../contract";
import {
  ClarificationAgentUnavailable,
  ClarificationGenerationChanged,
  type WalkthroughHost,
} from "../host";

export class HostOperationFailed extends Schema.TaggedErrorClass<HostOperationFailed>()(
  "HostOperationFailed",
  { cause: Schema.Defect() },
) {}

/** The served adapter persisted only its browser backup. */
export class ReviewStateFallback extends Schema.TaggedErrorClass<ReviewStateFallback>()(
  "ReviewStateFallback",
  {},
) {}

export type SaveOutcome = "saved" | "fallback" | "failed";

export const loadHostReview = (host: WalkthroughHost["reviewState"]) =>
  host === undefined
    ? Effect.succeed(null)
    : Effect.tryPromise({
        try: (signal) => host.load(signal),
        catch: (cause) => new HostOperationFailed({ cause }),
      }).pipe(
        Effect.flatMap((state) =>
          state === null ? Effect.succeed(null) : parseReviewState(state),
        ),
      );

export const saveHostReview = (
  host: WalkthroughHost["reviewState"],
  state: ReviewState,
): Effect.Effect<SaveOutcome> =>
  host === undefined
    ? Effect.succeed("saved")
    : Effect.tryPromise({
        try: (signal) => host.save(state, signal),
        catch: (cause) =>
          cause instanceof ReviewStateFallback ? cause : new HostOperationFailed({ cause }),
      }).pipe(
        Effect.match({
          onSuccess: (): SaveOutcome => "saved",
          onFailure: (error): SaveOutcome =>
            error._tag === "ReviewStateFallback" ? "fallback" : "failed",
        }),
      );

export const decodeHostQa = (
  state: QaState | null,
  payload: Payload,
): Effect.Effect<QaState | null, QaStateInvalid | ClarificationGenerationChanged> =>
  state === null
    ? Effect.succeed(null)
    : parseQaState(state).pipe(
        Effect.flatMap((parsed) =>
          parsed.walkthrough === payload.sourcePath &&
          parsed.pr === payload.pr.number &&
          parsed.stamp === payload.commit
            ? Effect.succeed(parsed)
            : Effect.fail(new ClarificationGenerationChanged()),
        ),
      );

export const loadHostQa = (
  host: NonNullable<WalkthroughHost["clarifications"]>,
  payload: Payload,
) =>
  Effect.tryPromise({
    try: (signal) => host.load(signal),
    catch: (cause) => new HostOperationFailed({ cause }),
  }).pipe(Effect.flatMap((state) => decodeHostQa(state, payload)));

export const hostAgentStatus = (host: NonNullable<WalkthroughHost["clarifications"]>) =>
  Effect.tryPromise({
    try: (signal) => host.status(signal),
    catch: (cause) => new HostOperationFailed({ cause }),
  }).pipe(Effect.flatMap(parseQaAgentStatus));

export const askHostQa = (
  host: NonNullable<WalkthroughHost["clarifications"]>,
  request: QaAskRequest,
  payload: Payload,
) =>
  Effect.tryPromise({
    try: (signal) => host.ask(request, signal),
    catch: (cause) =>
      cause instanceof ClarificationAgentUnavailable ||
      cause instanceof ClarificationGenerationChanged
        ? cause
        : new HostOperationFailed({ cause }),
  }).pipe(Effect.flatMap((state) => decodeHostQa(state, payload)));
