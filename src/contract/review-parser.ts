/**
 * The review-state gate, shared by the CLI server and the SPA.
 *
 * Both sides read the same JSON from an edge — a file under `.balade/`, a PUT
 * body, localStorage — and neither trusts it. The module stays pure so `app/`
 * may import it: no node, no CLI runtime.
 */

import { Effect, Schema } from "effect";
import { ReviewState as ReviewStateSchema } from "./schema.js";

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
    /* SAFETY: JSON.parse returns `any`; the assertion only forgets it down to `unknown`. */
    try: () => JSON.parse(raw) as unknown,
    catch: (cause) => new ReviewJsonInvalid({ cause }),
  });
  return yield* parseReviewState(value);
});

/* Single-argument on purpose: the decoder accepts per-call options that could
   override the strict `onExcessProperty` gate; this wrapper never forwards them. */
export const parseReviewState = (value: Parameters<typeof decodeReviewState>[0]) =>
  decodeReviewState(value).pipe(Effect.mapError((cause) => new ReviewStateInvalid({ cause })));
