/**
 * The transition from a walkthrough selection to a running review server, and
 * the complete CLI review lifecycle shared by `open` and successful generation.
 */

import { Effect, Match, Schema } from "effect";
import {
  printSoft,
  served,
  stopMessage,
  stopReports,
  writeStderr,
  writeStdout,
} from "../terminal.js";
import { launchBrowser, type BrowserMode } from "./browser.js";
import { findAppBundle, serve, type AppBundleMissing, type AppBundleReadFailed } from "./http.js";
import {
  prepareSession,
  sessionErrorMessage,
  type Session,
  type SessionError,
  type SessionOptions,
  type Selection,
} from "./session.js";

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

interface RunReviewSessionOptions {
  readonly session: SessionOptions;
  readonly port: number;
  readonly browserMode: BrowserMode;
}

type ReviewSessionError =
  | AppBundleMissing
  | AppBundleReadFailed
  | SessionError
  | ReviewServerFailed;

/** Present one live session at the CLI boundary and own it until interruption. */
export const runReviewSession = Effect.fn("runReviewSession")((options: RunReviewSessionOptions) =>
  Effect.gen(function* () {
    const appDir = yield* findAppBundle();
    const result = yield* startReviewSession({
      session: options.session,
      port: options.port,
      appDir,
    });
    return yield* Match.valueTags(result, {
      ReviewSessionStarted: (started) =>
        Effect.gen(function* () {
          yield* Effect.sync(() => {
            printSoft(started.session.reports);
            writeStdout(
              reviewSessionStartedText(
                options.session.selection,
                started.session.paths,
                started.url,
              ),
            );
          });
          /* Launch failure is a notice: the scoped server remains available. */
          yield* launchBrowser(options.browserMode, started.url).pipe(
            Effect.catchTag("BrowserLaunchFailed", (error) =>
              Effect.sync(() => {
                writeStderr(
                  `warning your browser did not open (${error.reason})\n` +
                    `  fix Open ${error.url} yourself, or pass --no-browser.\n`,
                );
              }),
            ),
          );
          return yield* Effect.never;
        }),
      SessionNotStarted: ({ message }) => Effect.sync(() => stopMessage(message)),
      SessionFailed: ({ reports }) => Effect.sync(() => stopReports(reports)),
    });
  }).pipe(
    Effect.catch((error) => Effect.sync(() => stopMessage(reviewSessionErrorMessage(error)))),
  ),
);

const reviewSelectionNotice = (selection: Selection, paths: readonly string[]): string => {
  switch (selection.kind) {
    case "discovered":
      return (
        `No target given — serving ${paths.length} discovered ` +
        `walkthrough${paths.length === 1 ? "" : "s"}.\n`
      );
    case "pullHead":
      return (
        `Rendering walkthrough content from PR #${selection.number}'s head commit ` +
        `${selection.at.slice(0, 7)} — content you have not reviewed.\n`
      );
    case "files":
    case "workingTree":
      return "";
  }
};

export const reviewSessionStartedText = (
  selection: Selection,
  paths: readonly string[],
  url: string,
): string => {
  return reviewSelectionNotice(selection, paths) + `balade is serving ${served(paths)} at ${url}\n`;
};

const reviewSessionErrorMessage = (error: ReviewSessionError): string =>
  Match.valueTags(error, {
    AppBundleMissing: ({ note }) => note,
    AppBundleReadFailed: ({ note }) => note,
    ReviewServerFailed: ({ port }) =>
      port === 0
        ? "Could not start the live review server on a free local port."
        : `Could not start the live review server on port ${port}; choose another --port.`,
    NotARepository: sessionErrorMessage,
    CommandFailed: sessionErrorMessage,
    WalkthroughReadFailed: sessionErrorMessage,
    WalkthroughFileReadFailed: sessionErrorMessage,
    ServerSourceReadFailed: sessionErrorMessage,
    CommitUnresolvable: sessionErrorMessage,
    PathResolutionFailed: sessionErrorMessage,
  });
