/* The two store layers, driven through dependency layers for memory storage and
   fake fetch. The shared parser is covered in `test/parse-review.test.ts`. */

import { Effect, Layer, Option } from "effect";
import { describe, expect, it } from "@effect/vitest";
import type { ReviewState } from "../contract";
import { fetchLayer, storageLayer, type FetchLike, type StorageLike } from "./browser";
import { loadReview, reviewStoreLayer, saveReview, type ReviewStoreTarget } from "./store";

const KEY = "balade:acme/repo#42:walkthroughs/one.md";

const exportTarget = { mode: "export", storageKey: KEY } satisfies ReviewStoreTarget;
const servedTarget = {
  mode: "served",
  storageKey: KEY,
  sourcePath: "walkthroughs/one.md",
} satisfies ReviewStoreTarget;

const state: ReviewState = {
  version: 1,
  walkthrough: "walkthroughs/one.md",
  pr: 42,
  stamp: "9f3c2ad",
  sections: { intro: { hash: "sha256:aa", at: "2026-01-01T09:00:00.000Z" } },
  files: { "intro//models/pool.py": { hash: "sha256:bb", at: "2026-01-01T09:01:00.000Z" } },
};

function memoryStorage(seed: Record<string, string> = {}): StorageLike & {
  entries: Map<string, string>;
} {
  const entries = new Map(Object.entries(seed));
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}

/** Private mode, or a full quota. */
const refusingStorage: StorageLike = {
  getItem: () => null,
  setItem: () => {
    throw new Error("quota exceeded");
  },
};

const answering =
  (status: number, body = ""): FetchLike =>
  () =>
    Promise.resolve(new Response(body, { status }));

const storeTestLayer = (fetch: FetchLike, storage: StorageLike) =>
  reviewStoreLayer.pipe(Layer.provide(Layer.merge(fetchLayer(fetch), storageLayer(storage))));

const unusedFetch: FetchLike = () => Promise.reject(new Error("fetch should not be used"));

describe("the browser store", () => {
  it.effect("reads its copy back through the parser", () => {
    const storage = memoryStorage({ [KEY]: JSON.stringify(state) });
    return Effect.gen(function* () {
      expect(Option.getOrNull(yield* loadReview(exportTarget))).toEqual(state);
    }).pipe(Effect.provide(storeTestLayer(unusedFetch, storage)));
  });

  it.effect("answers None on a copy it cannot read", () => {
    const storage = memoryStorage({ [KEY]: "{ not json" });
    return Effect.gen(function* () {
      expect(Option.isNone(yield* loadReview(exportTarget))).toBe(true);
    }).pipe(Effect.provide(storeTestLayer(unusedFetch, storage)));
  });

  it.effect("names a write the browser refused", () =>
    Effect.gen(function* () {
      expect(yield* saveReview(exportTarget, state)).toBe("failed");
    }).pipe(Effect.provide(storeTestLayer(unusedFetch, refusingStorage))),
  );
});

describe("the served store", () => {
  it.effect("consults the browser copy when the CLI holds nothing", () => {
    const storage = memoryStorage({ [KEY]: JSON.stringify(state) });
    return Effect.gen(function* () {
      expect(Option.getOrNull(yield* loadReview(servedTarget))).toEqual(state);
    }).pipe(Effect.provide(storeTestLayer(answering(404), storage)));
  });

  it.effect("takes the CLI answer when there is one", () =>
    Effect.gen(function* () {
      expect(Option.getOrNull(yield* loadReview(servedTarget))).toEqual(state);
    }).pipe(Effect.provide(storeTestLayer(answering(200, JSON.stringify(state)), memoryStorage()))),
  );

  it.effect("uses the browser copy when the CLI answer is invalid", () => {
    const storage = memoryStorage({ [KEY]: JSON.stringify(state) });
    return Effect.gen(function* () {
      expect(Option.getOrNull(yield* loadReview(servedTarget))).toEqual(state);
    }).pipe(Effect.provide(storeTestLayer(answering(200, "{ not json"), storage)));
  });

  it.effect("reports a failed PUT and keeps the marks in the browser", () => {
    const storage = memoryStorage();
    return Effect.gen(function* () {
      expect(yield* saveReview(servedTarget, state)).toBe("fallback");
      expect(JSON.parse(storage.entries.get(KEY) ?? "null")).toEqual(state);
    }).pipe(Effect.provide(storeTestLayer(answering(503), storage)));
  });

  it.effect("reports a write that reached nothing at all", () =>
    Effect.gen(function* () {
      expect(yield* saveReview(servedTarget, state)).toBe("failed");
    }).pipe(
      Effect.provide(storeTestLayer(() => Promise.reject(new Error("offline")), refusingStorage)),
    ),
  );

  it.effect("says so when the PUT went through", () => {
    const calls: string[] = [];
    const fetch: FetchLike = (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return Promise.resolve(new Response("", { status: 200 }));
    };
    return Effect.gen(function* () {
      expect(yield* saveReview(servedTarget, state)).toBe("saved");
      expect(calls).toEqual(["PUT /api/state?path=walkthroughs%2Fone.md"]);
    }).pipe(Effect.provide(storeTestLayer(fetch, memoryStorage())));
  });
});
