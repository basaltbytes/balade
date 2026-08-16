/** Browser Q&A requests keep JSON unknown until the shared contract decodes it. */

import { Effect } from "effect";
import { describe, expect, it } from "@effect/vitest";
import type { QaState } from "../contract";
import { fetchLayer, type BrowserFetch, type FetchLike } from "./browser";
import { askQa, fetchQa, fetchQaAgentStatus } from "./qa";

const state: QaState = {
  version: 1,
  walkthrough: "walkthroughs/one.md",
  pr: 42,
  stamp: "0123456789abcdef",
  threads: [],
};

const withFetch = <A, E>(effect: Effect.Effect<A, E, BrowserFetch>, fetch: FetchLike) =>
  effect.pipe(Effect.provide(fetchLayer(fetch)));

describe("the browser clarification API", () => {
  it.effect("decodes a state and encodes a new question", () => {
    const calls: Array<{ url: string; method: string; body: string }> = [];
    const fetch: FetchLike = (url, init) => {
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: String(init?.body ?? ""),
      });
      return Promise.resolve(
        Response.json(url === "/api/agent" ? { status: "setup-required" } : state),
      );
    };
    return withFetch(
      Effect.gen(function* () {
        expect(yield* fetchQaAgentStatus()).toEqual({ status: "setup-required" });
        expect(yield* fetchQa(state.walkthrough)).toEqual(state);
        expect(
          yield* askQa(state.walkthrough, {
            kind: "new",
            anchor: { sectionId: "overview", excerpt: "selected passage" },
            question: "Why?",
          }),
        ).toEqual(state);
        expect(calls).toEqual([
          {
            url: "/api/agent",
            method: "GET",
            body: "",
          },
          {
            url: "/api/qa?path=walkthroughs%2Fone.md",
            method: "GET",
            body: "",
          },
          {
            url: "/api/qa?path=walkthroughs%2Fone.md",
            method: "POST",
            body: JSON.stringify({
              kind: "new",
              anchor: { sectionId: "overview", excerpt: "selected passage" },
              question: "Why?",
            }),
          },
        ]);
      }),
      fetch,
    );
  });

  it.effect("rejects malformed successful responses and refused requests", () =>
    Effect.gen(function* () {
      const malformed = yield* Effect.flip(
        withFetch(fetchQa(state.walkthrough), () => Promise.resolve(Response.json({ version: 1 }))),
      );
      expect(malformed._tag).toBe("QaResponseInvalid");

      const malformedStatus = yield* Effect.flip(
        withFetch(fetchQaAgentStatus(), () => Promise.resolve(Response.json({ status: "maybe" }))),
      );
      expect(malformedStatus._tag).toBe("QaResponseInvalid");

      const refused = yield* Effect.flip(
        withFetch(fetchQa(state.walkthrough), () =>
          Promise.resolve(new Response("", { status: 503 })),
        ),
      );
      expect(refused._tag).toBe("QaFetchFailed");
    }),
  );
});
