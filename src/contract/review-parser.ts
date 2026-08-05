/**
 * The review-state gate, shared by the CLI server and the SPA.
 *
 * Both sides read the same JSON from an edge — a file under `.balade/`, a PUT
 * body, localStorage — and neither trusts it. The module stays pure so `app/`
 * may import it: no node, no CLI runtime.
 */

import { Effect, Schema } from "effect";
import { ReviewState as ReviewStateSchema } from "./schema.js";
import type { ReviewState } from "./types.js";

const decodeReviewState = Schema.decodeUnknownEffect(ReviewStateSchema, {
  onExcessProperty: "error",
});

export class ReviewJsonInvalid extends Schema.TaggedErrorClass<ReviewJsonInvalid>()(
  "ReviewJsonInvalid",
  { cause: Schema.Defect() },
) {}

export class ReviewStateInvalid extends Schema.TaggedErrorClass<ReviewStateInvalid>()(
  "ReviewStateInvalid",
  { cause: Schema.Defect() },
) {}

export type ReviewParseError = ReviewJsonInvalid | ReviewStateInvalid;

/** A serialized state from any edge, parsed without discarding its failure reason. */
export const parseReviewJson = Effect.fn("parseReviewJson")(function* (raw: string) {
  const value: unknown = yield* Effect.try({
    try: () => JSON.parse(raw) as unknown,
    catch: (cause) => new ReviewJsonInvalid({ cause }),
  });
  return yield* parseReviewState(value);
});

export const parseReviewState = (value: unknown): Effect.Effect<ReviewState, ReviewStateInvalid> =>
  decodeReviewState(value).pipe(Effect.mapError((cause) => new ReviewStateInvalid({ cause })));
