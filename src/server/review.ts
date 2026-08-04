/** The shared transition from a prepared walkthrough selection to a live server. */

import { Effect, Match, Schema } from "effect";
import type { BrowserLaunchFailed } from "./browser.js";
import { serve } from "./serve.js";
import type { Prepared, Session } from "./session.js";

export interface ReviewSessionStarted {
  readonly _tag: "ReviewSessionStarted";
  readonly session: Session;
  readonly url: string;
}

export type ReviewSessionResult =
  | ReviewSessionStarted
  | Exclude<Prepared, { readonly _tag: "SessionReady" }>;

export class ReviewServerFailed extends Schema.TaggedErrorClass<ReviewServerFailed>()(
  "ReviewServerFailed",
  { port: Schema.Finite, cause: Schema.Defect() },
) {
  get note(): string {
    return this.port === 0
      ? "Could not start the live review server on a free local port."
      : `Could not start the live review server on port ${this.port}; choose another --port.`;
  }
}

/** Only a ready selection opens a port; rejected selections stay report values. */
export const serveReviewSession = Effect.fn("serveReviewSession")(function* (
  prepared: Prepared,
  options: { readonly appDir: string; readonly port: number },
) {
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

export const reviewSessionStartedText = (result: ReviewSessionStarted): string =>
  `balade is serving ${served(result.session.paths)} at ${result.url}\n`;

export const browserLaunchWarningText = (error: BrowserLaunchFailed): string =>
  `warning your browser did not open (${error.reason})\n` +
  `  fix Open ${error.url} yourself, or pass --no-browser.\n`;

const served = (paths: readonly string[]): string =>
  paths.length === 1 ? (paths[0] ?? "") : `${paths.length} walkthroughs`;
