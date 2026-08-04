/* The payload parse, on its own: the app never types a body it has not read. */

import { Effect, Option, Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import {
  IndexPayload as IndexPayloadSchema,
  Payload as PayloadSchema,
} from "../../../src/payload/schema";
import { fetchLayer, type BrowserFetch, type FetchLike } from "./browser";
import { fetchHeadDistance, loadPayload, type RouteLocation } from "./source";

const walkthrough = {
  walkthrough: 1,
  title: "Add live planning pool items",
  commit: "9f3c2ad",
  headDistance: 0,
  lang: "en",
  meta: {},
  pr: {
    number: 42,
    url: "https://example.test/pull/42",
    author: "octo",
    state: "open",
    base: "main",
    head: "feature/one",
    commits: 3,
    stats: { files: 0, additions: 0, deletions: 0 },
  },
  files: [],
  nav: [],
  sections: [],
  errors: [],
  sourcePath: "walkthroughs/one.md",
  storageKey: "balade:acme/repo#42:walkthroughs/one.md",
};

const index = { kind: "index", repo: "acme/repo", entries: [] };

const location: RouteLocation = { search: "", hash: "", pathname: "/" };
const loadablePayload = Schema.Union([PayloadSchema, IndexPayloadSchema]);

const withFetch = <A, E>(effect: Effect.Effect<A, E, BrowserFetch>, fetch: FetchLike) =>
  effect.pipe(Effect.provide(fetchLayer(fetch)));

describe("loadPayload", () => {
  it.effect.prop(
    "round-trips schema-generated baked payloads",
    { expected: loadablePayload },
    ({ expected }) =>
      withFetch(
        Effect.gen(function* () {
          const serialized: unknown = JSON.parse(JSON.stringify(expected));
          const loaded = yield* loadPayload(location, serialized);
          expect(loaded.payload).toEqual(serialized);
        }),
        () => Promise.reject(new Error("fetch should not be used")),
      ),
    { fastCheck: { numRuns: 25 } },
  );

  it.effect("loads and decodes a baked walkthrough", () =>
    withFetch(
      Effect.gen(function* () {
        expect(yield* loadPayload(location, walkthrough)).toEqual({
          kind: "walkthrough",
          payload: walkthrough,
          served: false,
        });
      }),
      () => Promise.reject(new Error("fetch should not be used")),
    ),
  );

  it.effect("loads and decodes a baked index", () =>
    withFetch(
      Effect.gen(function* () {
        expect(yield* loadPayload(location, index)).toEqual({ kind: "index", payload: index });
      }),
      () => Promise.reject(new Error("fetch should not be used")),
    ),
  );

  it.effect("deeply refuses invalid baked data", () =>
    withFetch(
      Effect.gen(function* () {
        const invalid = [
          { ...walkthrough, walkthrough: 2 },
          { ...walkthrough, sections: {} },
          { ...walkthrough, pr: "42" },
          { ...walkthrough, storageKey: 7 },
          { ...index, entries: null },
          { ...index, entries: [{ path: "walkthroughs/one.md" }] },
          {
            ...walkthrough,
            sections: [
              {
                id: "intro",
                title: "Intro",
                hash: "sha256:aa",
                blocks: [{ b: "callout", body: [{ c: 7 }] }],
              },
            ],
          },
          0,
          "payload",
          [],
          {},
          { kind: "index" },
        ];
        for (const value of invalid) {
          const error = yield* Effect.flip(loadPayload(location, value));
          expect(error._tag).toBe("PayloadUnreadable");
        }
      }),
      () => Promise.reject(new Error("fetch should not be used")),
    ),
  );

  it.effect("loads and decodes a served payload", () =>
    Effect.gen(function* () {
      expect(yield* loadPayload(location, undefined)).toEqual({
        kind: "walkthrough",
        payload: walkthrough,
        served: true,
      });
    }).pipe(Effect.provide(fetchLayer(() => Promise.resolve(Response.json(walkthrough))))),
  );

  it.effect("names a failed request", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(loadPayload(location, undefined));
      expect(error._tag).toBe("PayloadFetchFailed");
    }).pipe(Effect.provide(fetchLayer(() => Promise.reject(new Error("offline"))))),
  );

  it.effect("names a refused response as a failed request", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(loadPayload(location, undefined));
      expect(error._tag).toBe("PayloadFetchFailed");
    }).pipe(Effect.provide(fetchLayer(() => Promise.resolve(new Response("", { status: 503 }))))),
  );

  it.effect("names unreadable served data", () =>
    withFetch(
      Effect.gen(function* () {
        const error = yield* Effect.flip(loadPayload(location, undefined));
        expect(error._tag).toBe("PayloadUnreadable");
      }),
      () => Promise.resolve(Response.json({ walkthrough: 2 })),
    ),
  );

  it.effect("deeply refuses unreadable served data", () =>
    withFetch(
      Effect.gen(function* () {
        const error = yield* Effect.flip(loadPayload(location, undefined));
        expect(error._tag).toBe("PayloadUnreadable");
      }),
      () =>
        Promise.resolve(
          Response.json({
            ...walkthrough,
            sections: [
              {
                id: "intro",
                title: "Intro",
                hash: "sha256:aa",
                blocks: [{ b: "callout", body: [{ c: 7 }] }],
              },
            ],
          }),
        ),
    ),
  );

  it.effect("keeps an unreadable baked payload distinct", () =>
    withFetch(
      Effect.gen(function* () {
        const error = yield* Effect.flip(loadPayload(location, { walkthrough: 2 }));
        expect(error._tag).toBe("PayloadUnreadable");
        if (error._tag === "PayloadUnreadable") expect(error.source).toBe("baked");
      }),
      () => Promise.resolve(Response.json(walkthrough)),
    ),
  );

  it.effect("names malformed hash and pathname encodings", () =>
    withFetch(
      Effect.gen(function* () {
        for (const malformed of [
          { search: "", hash: "#/%", pathname: "/" },
          { search: "", hash: "", pathname: "/w/%" },
        ]) {
          const error = yield* Effect.flip(loadPayload(malformed, undefined));
          expect(error._tag).toBe("PayloadLocationInvalid");
        }
      }),
      () => Promise.reject(new Error("fetch should not be used")),
    ),
  );

  it.effect("decodes the staleness response", () =>
    withFetch(
      Effect.gen(function* () {
        expect(Option.getOrNull(yield* fetchHeadDistance("walkthroughs/one.md"))).toBe(3);
      }),
      () => Promise.resolve(Response.json({ headDistance: 3 })),
    ),
  );

  it.effect("omits an invalid staleness response", () =>
    withFetch(
      Effect.gen(function* () {
        expect(Option.isNone(yield* fetchHeadDistance("walkthroughs/one.md"))).toBe(true);
      }),
      () => Promise.resolve(Response.json({ headDistance: "3" })),
    ),
  );
});
