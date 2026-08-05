/* Where the payload comes from, in order: the baked global of a static export,
   then the served endpoint, with the representative fixture as dev policy. */

import { Effect, Option, Schema } from "effect";
import {
  IndexPayload as IndexPayloadSchema,
  Payload as PayloadSchema,
} from "../../../src/contract/schema";
import type { IndexPayload, Payload } from "../contract";
import { BrowserFetch } from "./browser";

declare global {
  interface Window {
    /** Baked by the static export; unknown until `loadPayload` has decoded it. */
    __BALADE__?: unknown;
  }
}

export type Loaded =
  | { kind: "walkthrough"; payload: Payload; served: boolean }
  | { kind: "index"; payload: IndexPayload };

export interface RouteLocation {
  search: string;
  hash: string;
  pathname: string;
}

const decodePayloadEffect = Schema.decodeUnknownEffect(
  Schema.Union([PayloadSchema, IndexPayloadSchema]),
  { onExcessProperty: "error" },
);

const HeadDistance = Schema.Struct({ headDistance: Schema.Finite });
const decodeHeadDistance = Schema.decodeUnknownEffect(HeadDistance, {
  onExcessProperty: "error",
});

export class PayloadUnreadable extends Schema.TaggedErrorClass<PayloadUnreadable>()(
  "PayloadUnreadable",
  {
    source: Schema.Literals(["baked", "served"]),
    cause: Schema.Defect(),
  },
) {}

export class PayloadFetchFailed extends Schema.TaggedErrorClass<PayloadFetchFailed>()(
  "PayloadFetchFailed",
  {
    url: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class PayloadLocationInvalid extends Schema.TaggedErrorClass<PayloadLocationInvalid>()(
  "PayloadLocationInvalid",
  {
    source: Schema.Literals(["hash", "pathname"]),
    value: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export type PayloadLoadError = PayloadUnreadable | PayloadFetchFailed | PayloadLocationInvalid;

/** The walkthrough the location names, through `?path=`, `#/<path>` or `/w/<path>`. */
const decodeRoutePath = (
  source: "hash" | "pathname",
  value: string,
): Effect.Effect<string, PayloadLocationInvalid> =>
  Effect.try({
    try: () => decodeURIComponent(value),
    catch: (cause) => new PayloadLocationInvalid({ source, value, cause }),
  });

const walkthroughPath = Effect.fn("walkthroughPath")(function* (loc: RouteLocation) {
  const query = new URLSearchParams(loc.search).get("path");
  if (query) return query;
  if (loc.hash.startsWith("#/")) {
    const rest = loc.hash.slice(2);
    if (rest.length > 0) return yield* decodeRoutePath("hash", rest);
  }
  const fromPath = /^\/w\/(.+)$/.exec(loc.pathname);
  if (fromPath?.[1] !== undefined) return yield* decodeRoutePath("pathname", fromPath[1]);
  return null;
});

export const hrefFor = (path: string): string => `?path=${encodeURIComponent(path)}`;

const wrap = (data: Payload | IndexPayload, served: boolean): Loaded =>
  "kind" in data
    ? { kind: "index", payload: data }
    : { kind: "walkthrough", payload: data, served };

const fetchPayload = Effect.fn("fetchPayload")(function* (url: string) {
  const fetch = yield* BrowserFetch;
  const response = yield* Effect.tryPromise({
    try: (signal) => fetch(url, { headers: { accept: "application/json" }, signal }),
    catch: (cause) => new PayloadFetchFailed({ url, cause }),
  });
  if (!response.ok) {
    return yield* new PayloadFetchFailed({
      url,
      cause: { status: response.status, statusText: response.statusText },
    });
  }

  const body: unknown = yield* Effect.tryPromise({
    try: async (): Promise<unknown> => await response.json(),
    catch: (cause) => new PayloadUnreadable({ source: "served", cause }),
  });
  return yield* decodePayloadEffect(body).pipe(
    Effect.mapError((cause) => new PayloadUnreadable({ source: "served", cause })),
  );
});

/** Load and deeply decode the baked payload or the served JSON response. */
export const loadPayload = Effect.fn("loadPayload")(function* (
  loc: RouteLocation,
  bakedPayload: unknown,
) {
  const raw = bakedPayload;
  if (raw !== undefined && raw !== null) {
    const baked = yield* decodePayloadEffect(raw).pipe(
      Effect.mapError((cause) => new PayloadUnreadable({ source: "baked", cause })),
    );
    return wrap(baked, false);
  }

  const path = yield* walkthroughPath(loc);
  const url =
    path === null ? "/api/walkthrough" : `/api/walkthrough?path=${encodeURIComponent(path)}`;
  return wrap(yield* fetchPayload(url), true);
});

/** The app's development policy: missing served data opens the representative fixture. */
export const loadAppPayload = (
  loc: RouteLocation,
  bakedPayload: unknown,
): Effect.Effect<Loaded, PayloadLoadError, BrowserFetch> => {
  const load = loadPayload(loc, bakedPayload);
  if (!import.meta.env.DEV) return load;

  const fixture: Effect.Effect<Loaded> = Effect.promise(async () => {
    const { pr96 } = await import("../fixtures/pr96");
    return { kind: "walkthrough", payload: pr96, served: false };
  });
  return load.pipe(
    Effect.catchTags({
      PayloadUnreadable: (error) => (error.source === "served" ? fixture : Effect.fail(error)),
      PayloadFetchFailed: () => fixture,
      PayloadLocationInvalid: (error) => Effect.fail(error),
    }),
  );
};

/**
 * The index's staleness badge is one call per row, fired after the page shows.
 * A CLI that does not answer simply leaves the badge off.
 */
export const fetchHeadDistance = Effect.fn("fetchHeadDistance")(function* (path: string) {
  const fetch = yield* BrowserFetch;
  const response = yield* Effect.tryPromise((signal) =>
    fetch(`/api/staleness?path=${encodeURIComponent(path)}`, {
      headers: { accept: "application/json" },
      signal,
    }),
  ).pipe(Effect.option);
  if (Option.isNone(response) || !response.value.ok) return Option.none();

  const decoded = yield* Effect.tryPromise(
    async (): Promise<unknown> => await response.value.json(),
  ).pipe(Effect.flatMap(decodeHeadDistance), Effect.option);
  return Option.map(decoded, ({ headDistance }) => headDistance);
});
