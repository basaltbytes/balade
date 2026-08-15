/**
 * What the six served endpoints answer. Successes and typed `ApiError`
 * failures stay independent of HTTP; `http.ts` maps them to JSON and status
 * codes. Tests drive these ports without a socket.
 *
 * `?path=` is untrusted input: it names a walkthrough this run serves or it
 * names nothing at all — which is also what keeps the parameter from reaching
 * the file system.
 */

import { Effect, Match, Option, Schema } from "effect";
import { parseQaAskJson } from "../contract/qa-parser.js";
import { parseReviewJson } from "../contract/review-parser.js";
import type {
  CheckDiagnostic,
  IndexEntry,
  IndexPayload,
  Payload,
  QaState,
  ReviewState,
} from "../contract/types.js";
import { ReviewStateStore, type ReviewStateStorePort } from "../state.js";
import { PayloadCache, type PayloadCachePort } from "./cache.js";
import { ServerRepo, type ServerRepoPort } from "./repo.js";
import { QaWorkflow, type QaWorkflowError, type QaWorkflowPort } from "./qa.js";

export class ApiPathRequired extends Schema.TaggedErrorClass<ApiPathRequired>()(
  "ApiPathRequired",
  {},
) {}

export class ApiTargetNotServed extends Schema.TaggedErrorClass<ApiTargetNotServed>()(
  "ApiTargetNotServed",
  { path: Schema.String },
) {}

export class ApiWalkthroughUnavailable extends Schema.TaggedErrorClass<ApiWalkthroughUnavailable>()(
  "ApiWalkthroughUnavailable",
  { path: Schema.String, cause: Schema.Defect() },
) {}

export class ApiReviewStateNotFound extends Schema.TaggedErrorClass<ApiReviewStateNotFound>()(
  "ApiReviewStateNotFound",
  { path: Schema.String },
) {}

export class ApiReviewStateInvalid extends Schema.TaggedErrorClass<ApiReviewStateInvalid>()(
  "ApiReviewStateInvalid",
  { cause: Schema.Defect() },
) {}

export class ApiReviewStateMismatch extends Schema.TaggedErrorClass<ApiReviewStateMismatch>()(
  "ApiReviewStateMismatch",
  { requestPath: Schema.String, statePath: Schema.String },
) {}

export class ApiReviewStateUnavailable extends Schema.TaggedErrorClass<ApiReviewStateUnavailable>()(
  "ApiReviewStateUnavailable",
  { path: Schema.String, cause: Schema.Defect() },
) {}

export class ApiStampUnreadable extends Schema.TaggedErrorClass<ApiStampUnreadable>()(
  "ApiStampUnreadable",
  { path: Schema.String },
) {}

export class ApiStampUnresolvable extends Schema.TaggedErrorClass<ApiStampUnresolvable>()(
  "ApiStampUnresolvable",
  { pin: Schema.String },
) {}

export class ApiQaRequestInvalid extends Schema.TaggedErrorClass<ApiQaRequestInvalid>()(
  "ApiQaRequestInvalid",
  { cause: Schema.Defect() },
) {}

export type ApiError =
  | ApiPathRequired
  | ApiTargetNotServed
  | ApiWalkthroughUnavailable
  | ApiReviewStateNotFound
  | ApiReviewStateInvalid
  | ApiReviewStateMismatch
  | ApiReviewStateUnavailable
  | ApiStampUnreadable
  | ApiStampUnresolvable
  | ApiQaRequestInvalid
  | QaWorkflowError;

/** The slice of the repository adapter the answers read. */
export interface ApiRepo {
  readonly slug: string;
  readonly pin: ServerRepoPort["pin"];
  readonly distance: ServerRepoPort["distance"];
  readonly row: ServerRepoPort["row"];
}

interface ApiPorts {
  /** Served walkthroughs, repo-relative. More than one puts the index on the bare endpoint. */
  paths: readonly string[];
  payloads: PayloadCachePort;
  state: ReviewStateStorePort;
  qa: QaWorkflowPort;
  repo: ApiRepo;
}

export interface Api {
  /** `GET /api/walkthrough` — one payload, or the index when several are served. */
  walkthrough(path: string | null): Effect.Effect<Payload | IndexPayload, ApiError>;
  /** `GET /api/state` — the marks on disk, 404 when the CLI holds none. */
  readState(path: string | null): Effect.Effect<ReviewState, ApiError>;
  /** `PUT /api/state` — the body text is untrusted until it parses. */
  writeState(path: string | null, body: string): Effect.Effect<ReviewState, ApiError>;
  /** `GET /api/staleness` — how far the head moved past the stamp. */
  staleness(path: string | null): Effect.Effect<{ headDistance: number }, ApiError>;
  /** `GET /api/qa` — generation-bound clarification threads. */
  readQa(path: string | null): Effect.Effect<QaState, ApiError>;
  /** `POST /api/qa` — validate and enqueue one new question or follow-up. */
  askQa(path: string | null, body: string): Effect.Effect<QaState, ApiError>;
}

/** What `?path=` resolved to. `index` means "no path given, and several served". */
type Target = { kind: "one"; path: string } | { kind: "index" } | { kind: "unknown" };

const NEEDS_PATH = "This run serves several walkthroughs; name one with `?path=`.";

export const createApi = Effect.fn("createApi")(function* (paths: readonly string[]) {
  const payloads = yield* PayloadCache;
  const state = yield* ReviewStateStore;
  const qa = yield* QaWorkflow;
  const repo = yield* ServerRepo;
  return makeApi({ paths, payloads, state, qa, repo });
});

function makeApi(ports: ApiPorts): Api {
  const served = new Set(ports.paths);
  const only = ports.paths.length === 1 ? ports.paths[0] : undefined;

  const targetOf = (path: string | null): Target => {
    if (path === null) return only === undefined ? { kind: "index" } : { kind: "one", path: only };
    return served.has(path) ? { kind: "one", path } : { kind: "unknown" };
  };

  const notServed = (path: string | null) => new ApiTargetNotServed({ path: path ?? "" });

  /** Every per-file endpoint needs one walkthrough, never the index. */
  const oneOf = (path: string | null): Effect.Effect<string, ApiError> => {
    const target = targetOf(path);
    if (target.kind === "one") return Effect.succeed(target.path);
    if (target.kind === "index") return new ApiPathRequired({});
    return notServed(path);
  };

  return {
    walkthrough: Effect.fn("Api.walkthrough")(function* (path) {
      const target = targetOf(path);
      if (target.kind === "unknown") return yield* notServed(path);
      if (target.kind === "index") return yield* buildIndex(ports);

      const loaded = yield* ports.payloads
        .get(target.path)
        .pipe(Effect.mapError(walkthroughUnavailable(target.path)));
      if (loaded.payload === null) {
        return yield* new ApiWalkthroughUnavailable({
          path: target.path,
          cause: firstFailure(loaded.diagnostics),
        });
      }
      return loaded.payload;
    }),

    readState: Effect.fn("Api.readState")(function* (path) {
      const target = yield* oneOf(path);

      const stored = yield* ports.state
        .read(target)
        .pipe(Effect.mapError(reviewStateUnavailable(target)));
      return Option.isSome(stored)
        ? stored.value
        : yield* new ApiReviewStateNotFound({ path: target });
    }),

    writeState: Effect.fn("Api.writeState")(function* (path, body) {
      const target = yield* oneOf(path);

      const state = yield* parseReviewJson(body).pipe(
        Effect.mapError((cause) => new ApiReviewStateInvalid({ cause })),
      );
      if (state.walkthrough !== target) {
        return yield* new ApiReviewStateMismatch({
          requestPath: target,
          statePath: state.walkthrough,
        });
      }
      yield* ports.state.write(target, state).pipe(Effect.mapError(reviewStateUnavailable(target)));
      return state;
    }),

    staleness: Effect.fn("Api.staleness")(function* (path) {
      const target = yield* oneOf(path);

      const pin = yield* ports.repo
        .pin(target)
        .pipe(Effect.mapError(walkthroughUnavailable(target)));
      if (Option.isNone(pin)) return yield* new ApiStampUnreadable({ path: target });
      const headDistance = yield* ports.repo
        .distance(pin.value)
        .pipe(Effect.mapError(walkthroughUnavailable(target)));
      if (Option.isNone(headDistance)) {
        return yield* new ApiStampUnresolvable({ pin: pin.value });
      }
      return { headDistance: headDistance.value };
    }),

    readQa: Effect.fn("Api.readQa")(function* (path) {
      return yield* ports.qa.read(yield* oneOf(path));
    }),

    askQa: Effect.fn("Api.askQa")(function* (path, body) {
      const target = yield* oneOf(path);
      const request = yield* parseQaAskJson(body).pipe(
        Effect.mapError((cause) => new ApiQaRequestInvalid({ cause })),
      );
      return yield* ports.qa.ask(target, request);
    }),
  };
}

/**
 * The index reads frontmatter, `git log -1` and the local state files (#21) —
 * never a resolve, so a repository of twenty walkthroughs still answers at once.
 * Progress counts the marks that are on disk; the walkthrough itself applies the
 * hash rule when it opens.
 */
const buildIndex = Effect.fn("Api.buildIndex")(function* (ports: ApiPorts) {
  const entries: IndexEntry[] = [];
  for (const path of ports.paths) {
    const row = yield* ports.repo.row(path).pipe(Effect.mapError(walkthroughUnavailable(path)));
    if (Option.isNone(row)) continue;

    const stored = yield* ports.state
      .read(path)
      .pipe(Effect.mapError(reviewStateUnavailable(path)));
    const done = Option.match(stored, {
      onNone: () => Option.none<number>(),
      onSome: (state) =>
        Option.some(Math.min(Object.keys(state.sections).length, row.value.sections)),
    });
    const progressFacet: ProgressFacet = {};
    if (Option.isSome(done)) {
      progressFacet.progress = { done: done.value, total: row.value.sections };
    }
    entries.push({
      path,
      title: row.value.title,
      pr: row.value.pr,
      meta: row.value.meta,
      updatedAt: row.value.updatedAt,
      ...progressFacet,
    });
  }
  return { kind: "index", repo: ports.repo.slug, entries } satisfies IndexPayload;
});

type ProgressFacet = { progress?: NonNullable<IndexEntry["progress"]> };

const walkthroughUnavailable = (path: string) => (cause: unknown) =>
  new ApiWalkthroughUnavailable({ path, cause });

const reviewStateUnavailable = (path: string) => (cause: unknown) =>
  new ApiReviewStateUnavailable({ path, cause });

function firstFailure(diagnostics: readonly CheckDiagnostic[]): string {
  const failure = diagnostics.find((diagnostic) => diagnostic.level === "error");
  return failure === undefined
    ? "The walkthrough no longer compiles."
    : `${failure.code}: ${failure.message}`;
}

export interface ApiErrorResponse {
  readonly status: 400 | 404 | 409 | 500 | 503;
  readonly message: string;
}

export function apiErrorResponse(error: ApiError): ApiErrorResponse {
  return Match.valueTags(error, {
    ApiPathRequired: (): ApiErrorResponse => ({ status: 400, message: NEEDS_PATH }),
    ApiReviewStateInvalid: (): ApiErrorResponse => ({
      status: 400,
      message: "The body is not a review state: it needs version 1, walkthrough, pr and stamp.",
    }),
    ApiQaRequestInvalid: (): ApiErrorResponse => ({
      status: 400,
      message: "The body is not a valid clarification question.",
    }),
    ApiReviewStateMismatch: ({ statePath, requestPath }): ApiErrorResponse => ({
      status: 400,
      message: `The body names \`${statePath}\`, but the request names \`${requestPath}\`.`,
    }),
    ApiTargetNotServed: ({ path }): ApiErrorResponse => ({
      status: 404,
      message: `This run does not serve \`${path}\`.`,
    }),
    ApiReviewStateNotFound: ({ path }): ApiErrorResponse => ({
      status: 404,
      message: `No review state for \`${path}\` yet.`,
    }),
    ApiStampUnreadable: ({ path }): ApiErrorResponse => ({
      status: 404,
      message: `\`${path}\` carries no readable stamp.`,
    }),
    ApiStampUnresolvable: ({ pin }): ApiErrorResponse => ({
      status: 404,
      message: `The stamp \`${pin}\` is not in this clone.`,
    }),
    ApiWalkthroughUnavailable: ({ path }): ApiErrorResponse => ({
      status: 500,
      message: `Walkthrough \`${path}\` is unavailable.`,
    }),
    ApiReviewStateUnavailable: ({ path }): ApiErrorResponse => ({
      status: 500,
      message: `Review state for \`${path}\` is unavailable.`,
    }),
    QaSectionNotFound: ({ sectionId }): ApiErrorResponse => ({
      status: 400,
      message: `Section \`${sectionId}\` is not in this walkthrough.`,
    }),
    QaThreadNotFound: (): ApiErrorResponse => ({
      status: 404,
      message: "This clarification thread no longer exists.",
    }),
    QaThreadBusy: (): ApiErrorResponse => ({
      status: 409,
      message: "This clarification thread is already answering a question.",
    }),
    QaAgentUnavailable: ({ reason }): ApiErrorResponse => ({
      status: 503,
      message:
        reason === "model-not-configured"
          ? "Choose an agent model with `balade generate` before asking a clarification."
          : "The configured clarification agent is unavailable.",
    }),
    QaIdentifierFailed: (): ApiErrorResponse => ({
      status: 500,
      message: "The clarification question could not be created.",
    }),
    QaWalkthroughUnavailable: ({ path }): ApiErrorResponse => ({
      status: 500,
      message: `Walkthrough \`${path}\` is unavailable for clarification.`,
    }),
    QaStateUnavailable: ({ path }): ApiErrorResponse => ({
      status: 500,
      message: `Clarifications for \`${path}\` are unavailable.`,
    }),
  });
}
