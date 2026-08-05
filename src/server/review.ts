/** The transition from a walkthrough selection to a running review server. */

import { Effect, Match, Schema } from "effect";
import { serve } from "./serve.js";
import { prepareSession, type Session, type SessionOptions } from "./session.js";

interface ReviewSessionStarted {
  readonly _tag: "ReviewSessionStarted";
  readonly session: Session;
  readonly url: string;
}

export class ReviewServerFailed extends Schema.TaggedErrorClass<ReviewServerFailed>()(
  "ReviewServerFailed",
  { port: Schema.Finite, cause: Schema.Defect() },
) {}

interface StartReviewSessionOptions {
  readonly session: SessionOptions;
  readonly appDir: string;
  readonly port: number;
}

/** Prepare the selected walkthroughs and open a port only when they are ready. */
export const startReviewSession = Effect.fn("startReviewSession")(function* (
  options: StartReviewSessionOptions,
) {
  const prepared = yield* prepareSession(options.session);
  return yield* Match.valueTags(prepared, {
    SessionReady: ({ session }) =>
      serve({ appDir: options.appDir, port: options.port, api: session.api }).pipe(
        Effect.map((url): ReviewSessionStarted => ({ _tag: "ReviewSessionStarted", session, url })),
        Effect.mapError((cause) => new ReviewServerFailed({ port: options.port, cause })),
      ),
    SessionNotStarted: (result) => Effect.succeed(result),
    SessionFailed: (result) => Effect.succeed(result),
  });
});
