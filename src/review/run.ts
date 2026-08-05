/** The complete CLI review lifecycle shared by `open` and successful generation. */

import { Effect, Match } from "effect";
import { formatText } from "../check/report.js";
import type { CheckReport } from "../contract/types.js";
import { launchBrowser, type BrowserMode } from "../server/browser.js";
import { startReviewSession, type ReviewServerFailed } from "../server/review.js";
import { findAppBundle, type AppBundleMissing, type AppBundleReadFailed } from "../server/serve.js";
import { sessionErrorMessage, type SessionError, type SessionOptions } from "../server/session.js";
import { writeStderr, writeStdout } from "../terminal.js";

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
          printSoft(started.session.reports);
          writeStdout(`balade is serving ${served(started.session.paths)} at ${started.url}\n`);
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

/** The boundary echo is a `check` affordance; a live review shows diagnostics only. */
const diagnosticsOnly = (reports: readonly CheckReport[]): readonly CheckReport[] =>
  reports.map((report) => ({ ...report, ranges: [] }));

const stopReports = (reports: readonly CheckReport[]): void => {
  writeStdout(formatText({ reports: diagnosticsOnly(reports) }));
  process.exitCode = 1;
};

const stopMessage = (message: string): void => {
  writeStderr(`${message}\n`);
  process.exitCode = 1;
};

/** Soft commands carry unresolved content into the app after printing its diagnostics. */
const printSoft = (reports: readonly CheckReport[]): void => {
  const diagnostics = diagnosticsOnly(reports);
  if (diagnostics.some((report) => report.diagnostics.length > 0)) {
    writeStdout(formatText({ reports: diagnostics }));
  }
};

const served = (paths: readonly string[]): string =>
  paths.length === 1 ? (paths[0] ?? "") : `${paths.length} walkthroughs`;
