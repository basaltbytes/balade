/** The complete live-review lifecycle shared by `open` and successful generation. */

import { Effect, Match, Schema } from "effect";
import { formatText } from "../check/report.js";
import type { CheckReport } from "../payload/types.js";
import { sanitizeTerminalText } from "../terminal.js";
import { launchBrowser, type BrowserMode } from "./browser.js";
import { AppBundleMissing, AppBundleReadFailed, findAppBundle, serve } from "./serve.js";
import {
  prepareSession,
  sessionErrorMessage,
  type Prepared,
  type Session,
  type SessionError,
  type SessionOptions,
} from "./session.js";

interface ReviewSessionStarted {
  readonly _tag: "ReviewSessionStarted";
  readonly session: Session;
  readonly url: string;
}

class ReviewServerFailed extends Schema.TaggedErrorClass<ReviewServerFailed>()(
  "ReviewServerFailed",
  { port: Schema.Finite, cause: Schema.Defect() },
) {
  get note(): string {
    return this.port === 0
      ? "Could not start the live review server on a free local port."
      : `Could not start the live review server on port ${this.port}; choose another --port.`;
  }
}

interface StartReviewSessionOptions {
  readonly session: SessionOptions;
  readonly port: number;
}

interface RunReviewSessionOptions extends StartReviewSessionOptions {
  readonly browserMode: BrowserMode;
}

type ReviewSessionError =
  | AppBundleMissing
  | AppBundleReadFailed
  | SessionError
  | ReviewServerFailed;

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

/** Resolve the shipped app, prepare the repository session, and open its scoped port. */
const startReviewSession = Effect.fn("startReviewSession")(function* (
  options: StartReviewSessionOptions,
) {
  const appDir = yield* findAppBundle();
  const prepared = yield* prepareSession(options.session);
  return yield* serveReviewSession(prepared, { appDir, port: options.port });
});

/** Present one live session at the CLI boundary and own it until interruption. */
export const runReviewSession = Effect.fn("runReviewSession")((options: RunReviewSessionOptions) =>
  Effect.gen(function* () {
    const result = yield* startReviewSession(options);
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
    ReviewServerFailed: ({ note }) => note,
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

const writeStdout = (value: string): void => {
  process.stdout.write(sanitizeTerminalText(value));
};

const writeStderr = (value: string): void => {
  process.stderr.write(sanitizeTerminalText(value));
};

const served = (paths: readonly string[]): string =>
  paths.length === 1 ? (paths[0] ?? "") : `${paths.length} walkthroughs`;
