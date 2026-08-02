/**
 * What the four served endpoints answer. Successes and typed `ApiError`
 * failures stay independent of HTTP; `serve.ts` maps them to JSON and status
 * codes. Tests drive these ports without a socket.
 *
 * `?path=` is untrusted input: it names a walkthrough this run serves or it
 * names nothing at all — which is also what keeps the parameter from reaching
 * the file system.
 */

import { Effect, Option, Schema } from "effect";
import { describeFailure } from "../failure.js";
import { parseReviewState } from "../payload/parse-review.js";
import type {
  CheckDiagnostic,
  IndexEntry,
  IndexPayload,
  Payload,
  ReviewState,
} from "../payload/types.js";
import { ReviewStateStore, type ReviewStateStoreShape } from "../state/store.js";
import { PayloadCache, type PayloadCacheShape } from "./cache.js";
import { ServerRepo, type ServerRepoShape } from "./repo.js";

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
  { path: Schema.String, detail: Schema.String },
) {}

export class ApiReviewStateNotFound extends Schema.TaggedErrorClass<ApiReviewStateNotFound>()(
  "ApiReviewStateNotFound",
  { path: Schema.String },
) {}

export class ApiReviewStateInvalid extends Schema.TaggedErrorClass<ApiReviewStateInvalid>()(
  "ApiReviewStateInvalid",
  {},
) {}

export class ApiReviewStateMismatch extends Schema.TaggedErrorClass<ApiReviewStateMismatch>()(
  "ApiReviewStateMismatch",
  { requestPath: Schema.String, statePath: Schema.String },
) {}

export class ApiReviewStateUnavailable extends Schema.TaggedErrorClass<ApiReviewStateUnavailable>()(
  "ApiReviewStateUnavailable",
  { path: Schema.String, detail: Schema.String },
) {}

export class ApiStampUnreadable extends Schema.TaggedErrorClass<ApiStampUnreadable>()(
  "ApiStampUnreadable",
  { path: Schema.String },
) {}

export class ApiStampUnresolvable extends Schema.TaggedErrorClass<ApiStampUnresolvable>()(
  "ApiStampUnresolvable",
  { pin: Schema.String },
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
  | ApiStampUnresolvable;

/** The slice of the repository adapter the answers read. */
export interface ApiRepo {
  readonly slug: string;
  readonly pin: ServerRepoShape["pin"];
  readonly distance: ServerRepoShape["distance"];
  readonly row: ServerRepoShape["row"];
}

interface ApiPorts {
  /** Served walkthroughs, repo-relative. More than one puts the index on the bare endpoint. */
  paths: readonly string[];
  payloads: PayloadCacheShape;
  state: ReviewStateStoreShape;
  repo: ApiRepo;
}

export interface Api {
  /** `GET /api/walkthrough` — one payload, or the index when several are served. */
  walkthrough(path: string | null): Effect.Effect<Payload | IndexPayload, ApiError>;
  /** `GET /api/state` — the marks on disk, 404 when the CLI holds none. */
  readState(path: string | null): Effect.Effect<ReviewState, ApiError>;
  /** `PUT /api/state` — the body is unknown until it parses. */
  writeState(path: string | null, body: unknown): Effect.Effect<ReviewState, ApiError>;
  /** `GET /api/staleness` — how far the head moved past the stamp. */
  staleness(path: string | null): Effect.Effect<{ headDistance: number }, ApiError>;
}

/** What `?path=` resolved to. `index` means "no path given, and several served". */
type Target = { kind: "one"; path: string } | { kind: "index" } | { kind: "unknown" };

const NEEDS_PATH = "This run serves several walkthroughs; name one with `?path=`.";

export const createApi = Effect.fn("createApi")(function* (paths: readonly string[]) {
  const payloads = yield* PayloadCache;
  const state = yield* ReviewStateStore;
  const repo = yield* ServerRepo;
  return makeApi({ paths, payloads, state, repo });
});

function makeApi(ports: ApiPorts): Api {
  const served = new Set(ports.paths);
  const only = ports.paths.length === 1 ? ports.paths[0] : undefined;

  const targetOf = (path: string | null): Target => {
    if (path === null) return only === undefined ? { kind: "index" } : { kind: "one", path: only };
    return served.has(path) ? { kind: "one", path } : { kind: "unknown" };
  };

  const notServed = (path: string | null) => new ApiTargetNotServed({ path: path ?? "" });

  /** The three per-file endpoints all need one walkthrough, never the index. */
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
          detail: firstFailure(loaded.diagnostics),
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

      const state = yield* parseReviewState(body).pipe(
        Effect.mapError(() => new ApiReviewStateInvalid({})),
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
    entries.push({
      path,
      title: row.value.title,
      pr: row.value.pr,
      meta: row.value.meta,
      updatedAt: row.value.updatedAt,
      ...(Option.isNone(done) ? {} : { progress: { done: done.value, total: row.value.sections } }),
    });
  }
  return { kind: "index", repo: ports.repo.slug, entries } satisfies IndexPayload;
});

const walkthroughUnavailable = (path: string) => (error: unknown) =>
  new ApiWalkthroughUnavailable({ path, detail: describeFailure(error) });

const reviewStateUnavailable = (path: string) => (error: unknown) =>
  new ApiReviewStateUnavailable({ path, detail: describeFailure(error) });

function firstFailure(diagnostics: readonly CheckDiagnostic[]): string {
  const failure = diagnostics.find((diagnostic) => diagnostic.level === "error");
  return failure === undefined
    ? "The walkthrough no longer compiles."
    : `${failure.code}: ${failure.message}`;
}

export interface ApiErrorResponse {
  readonly status: 400 | 404 | 500;
  readonly message: string;
}

export function apiErrorResponse(error: ApiError): ApiErrorResponse {
  switch (error._tag) {
    case "ApiPathRequired":
      return { status: 400, message: NEEDS_PATH };
    case "ApiReviewStateInvalid":
      return {
        status: 400,
        message: "The body is not a review state: it needs version 1, walkthrough, pr and stamp.",
      };
    case "ApiReviewStateMismatch":
      return {
        status: 400,
        message: `The body names \`${error.statePath}\`, but the request names \`${error.requestPath}\`.`,
      };
    case "ApiTargetNotServed":
      return { status: 404, message: `This run does not serve \`${error.path}\`.` };
    case "ApiReviewStateNotFound":
      return { status: 404, message: `No review state for \`${error.path}\` yet.` };
    case "ApiStampUnreadable":
      return { status: 404, message: `\`${error.path}\` carries no readable stamp.` };
    case "ApiStampUnresolvable":
      return { status: 404, message: `The stamp \`${error.pin}\` is not in this clone.` };
    case "ApiWalkthroughUnavailable":
      return { status: 500, message: error.detail };
    case "ApiReviewStateUnavailable":
      return {
        status: 500,
        message: `Review state for \`${error.path}\` is unavailable (${error.detail}).`,
      };
  }
}
