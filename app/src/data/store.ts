/** Review-state persistence as an Effect service with local and served layers. */

import { Context, Effect, Layer, Option, Schema, Semaphore } from "effect";
import { parseReviewJson } from "../../../src/payload/parse-review";
import type { ReviewState } from "../contract";
import { BrowserFetch, BrowserStorage, type FetchLike, type StorageLike } from "./browser";

export type { FetchLike, StorageLike } from "./browser";

/** What a save reached: `"fallback"` means the endpoint refused and the browser copy took it. */
export type SaveOutcome = "saved" | "fallback" | "failed";

interface LocalReviewStoreClient {
  readonly load: (storageKey: string) => Effect.Effect<Option.Option<ReviewState>>;
  readonly save: (storageKey: string, state: ReviewState) => Effect.Effect<SaveOutcome>;
}

export type ReviewStoreTarget =
  | { readonly mode: "export"; readonly storageKey: string }
  | { readonly mode: "served"; readonly storageKey: string; readonly sourcePath: string };

type ServedReviewStoreTarget = Extract<ReviewStoreTarget, { mode: "served" }>;

interface HttpReviewStoreClient {
  readonly load: (target: ServedReviewStoreTarget) => Effect.Effect<Option.Option<ReviewState>>;
  readonly save: (
    target: ServedReviewStoreTarget,
    state: ReviewState,
  ) => Effect.Effect<SaveOutcome>;
}

export interface ReviewStoreShape {
  readonly load: (target: ReviewStoreTarget) => Effect.Effect<Option.Option<ReviewState>>;
  readonly save: (target: ReviewStoreTarget, state: ReviewState) => Effect.Effect<SaveOutcome>;
}

export class ReviewStore extends Context.Service<ReviewStore, ReviewStoreShape>()(
  "@balade/app/ReviewStore",
) {}

class LocalReviewStore extends Context.Service<LocalReviewStore, LocalReviewStoreClient>()(
  "@balade/app/LocalReviewStore",
) {}

class HttpReviewStore extends Context.Service<HttpReviewStore, HttpReviewStoreClient>()(
  "@balade/app/HttpReviewStore",
) {}

class ReviewStoreAccessFailed extends Schema.TaggedErrorClass<ReviewStoreAccessFailed>()(
  "ReviewStoreAccessFailed",
  {
    operation: Schema.Literals(["storage-read", "storage-write", "http-get", "http-put"]),
    target: Schema.String,
    cause: Schema.Defect(),
  },
) {}

const SAVED: SaveOutcome = "saved";
const FALLBACK: SaveOutcome = "fallback";
const FAILED: SaveOutcome = "failed";

function makeLocalStore(storage: StorageLike): LocalReviewStoreClient {
  return {
    load: Effect.fn("ReviewStore.local.load")(function* (storageKey) {
      const raw = yield* Effect.try({
        try: () => storage.getItem(storageKey),
        catch: (cause) =>
          new ReviewStoreAccessFailed({ operation: "storage-read", target: storageKey, cause }),
      }).pipe(
        Effect.catchTag("ReviewStoreAccessFailed", (error) =>
          Effect.logWarning(
            `balade: could not read browser review state for ${storageKey}.`,
            error,
          ).pipe(Effect.as(null)),
        ),
      );
      if (raw === null) return Option.none();

      return yield* parseReviewJson(raw).pipe(
        Effect.map(Option.some),
        Effect.catchTags({
          ReviewJsonInvalid: (error) =>
            Effect.logWarning(
              `balade: ignoring invalid browser review state for ${storageKey}.`,
              error,
            ).pipe(Effect.as(Option.none())),
          ReviewStateInvalid: (error) =>
            Effect.logWarning(
              `balade: ignoring invalid browser review state for ${storageKey}.`,
              error,
            ).pipe(Effect.as(Option.none())),
        }),
      );
    }),

    save: Effect.fn("ReviewStore.local.save")(function* (storageKey, state) {
      return yield* Effect.try({
        try: () => storage.setItem(storageKey, JSON.stringify(state)),
        catch: (cause) =>
          new ReviewStoreAccessFailed({ operation: "storage-write", target: storageKey, cause }),
      }).pipe(
        Effect.as(SAVED),
        Effect.catchTag("ReviewStoreAccessFailed", (error) =>
          Effect.logWarning(
            `balade: could not save browser review state for ${storageKey}.`,
            error,
          ).pipe(Effect.as(FAILED)),
        ),
      );
    }),
  };
}

function makeHttpStore(fetch: FetchLike, local: LocalReviewStoreClient): HttpReviewStoreClient {
  const load = Effect.fn("ReviewStore.http.load")(function* (target: ServedReviewStoreTarget) {
    const url = `/api/state?path=${encodeURIComponent(target.sourcePath)}`;
    const served = Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: (signal) => fetch(url, { headers: { accept: "application/json" }, signal }),
        catch: (cause) =>
          new ReviewStoreAccessFailed({ operation: "http-get", target: url, cause }),
      });
      /* 404 means the CLI holds nothing — not that nothing exists: marks made
         while it was down live on in the browser copy. */
      if (!response.ok) {
        if (response.status === 404) return yield* local.load(target.storageKey);
        return yield* new ReviewStoreAccessFailed({
          operation: "http-get",
          target: url,
          cause: { status: response.status, statusText: response.statusText },
        });
      }

      const raw = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: (cause) =>
          new ReviewStoreAccessFailed({ operation: "http-get", target: url, cause }),
      });
      return Option.some(yield* parseReviewJson(raw));
    });

    return yield* served.pipe(
      Effect.catchTags({
        ReviewStoreAccessFailed: (error) =>
          Effect.logWarning(
            "balade: could not load served review state; using the browser copy.",
            error,
          ).pipe(Effect.andThen(local.load(target.storageKey))),
        ReviewJsonInvalid: (error) =>
          Effect.logWarning(
            "balade: the served review state was invalid; using the browser copy.",
            error,
          ).pipe(Effect.andThen(local.load(target.storageKey))),
        ReviewStateInvalid: (error) =>
          Effect.logWarning(
            "balade: the served review state was invalid; using the browser copy.",
            error,
          ).pipe(Effect.andThen(local.load(target.storageKey))),
      }),
    );
  });

  const saveFallback = (
    target: ServedReviewStoreTarget,
    state: ReviewState,
  ): Effect.Effect<SaveOutcome> =>
    local
      .save(target.storageKey, state)
      .pipe(Effect.map((outcome) => (outcome === SAVED ? FALLBACK : FAILED)));

  const save = Effect.fn("ReviewStore.http.save")(function* (
    target: ServedReviewStoreTarget,
    state: ReviewState,
  ) {
    const url = `/api/state?path=${encodeURIComponent(target.sourcePath)}`;
    const served = Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          fetch(url, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(state),
            signal,
          }),
        catch: (cause) =>
          new ReviewStoreAccessFailed({ operation: "http-put", target: url, cause }),
      });
      if (!response.ok) {
        return yield* new ReviewStoreAccessFailed({
          operation: "http-put",
          target: url,
          cause: { status: response.status, statusText: response.statusText },
        });
      }
      return SAVED;
    });

    return yield* served.pipe(
      Effect.catchTag("ReviewStoreAccessFailed", (error) =>
        Effect.logWarning(
          "balade: could not save served review state; using the browser copy.",
          error,
        ).pipe(Effect.andThen(saveFallback(target, state))),
      ),
    );
  });

  return { load, save };
}

/** LocalStorage-only implementation. `BrowserStorage` is supplied by the outer runtime. */
export const localStore = Layer.effect(
  LocalReviewStore,
  Effect.gen(function* () {
    return makeLocalStore(yield* BrowserStorage);
  }),
);

/** Served implementation with LocalStorage fallback. Both browser seams are layer inputs. */
export const httpStore = Layer.effect(
  HttpReviewStore,
  Effect.gen(function* () {
    const fetch = yield* BrowserFetch;
    const local = yield* LocalReviewStore;
    return makeHttpStore(fetch, local);
  }),
);

const stores = httpStore.pipe(Layer.provideMerge(localStore));

/** The app-facing service keeps the implementation choice out of React. */
export const reviewStoreLayer = Layer.effect(
  ReviewStore,
  Effect.gen(function* () {
    const local = yield* LocalReviewStore;
    const http = yield* HttpReviewStore;
    const savePermit = yield* Semaphore.make(1);
    return {
      load: Effect.fn("ReviewStore.load")((target) =>
        target.mode === "served" ? http.load(target) : local.load(target.storageKey),
      ),
      save: Effect.fn("ReviewStore.save")((target, state) =>
        savePermit.withPermits(1)(
          target.mode === "served"
            ? http.save(target, state)
            : local.save(target.storageKey, state),
        ),
      ),
    };
  }),
).pipe(Layer.provide(stores));

export const loadReview = (target: ReviewStoreTarget) =>
  ReviewStore.use((store) => store.load(target));

export const saveReview = (target: ReviewStoreTarget, state: ReviewState) =>
  ReviewStore.use((store) => store.save(target, state));
