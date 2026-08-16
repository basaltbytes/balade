/** Clarification workflow through real git resolution and file sidecars, with Pi at its port. */

import { Effect, Layer } from "effect";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { contextResolverLive } from "../src/git/git.js";
import { AuthorModelId, AuthorProviderId, type AuthorModel } from "../src/pi/author.js";
import {
  ClarifierRequestFailed,
  WalkthroughClarifier,
  type ClarificationRequest,
} from "../src/pi/clarifier.js";
import type { Api } from "../src/server/api.js";
import { prepareSession } from "../src/server/session.js";
import { qaFileName } from "../src/state.js";
import { shellLayer } from "./support/effect.js";
import { createFixtureRepo } from "./support/repo.js";

const model: AuthorModel = {
  providerId: AuthorProviderId.make("fixture"),
  providerName: "Fixture",
  modelId: AuthorModelId.make("clarifier"),
  modelName: "Clarifier",
};

describe("the clarification workflow", () => {
  it.live("repairs one answer rejected by the canonical fragment compiler", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const repo = createFixtureRepo();
        yield* Effect.addFinalizer(() => Effect.sync(repo.cleanup));
        repo.addWalkthrough("valid.md", "valid.md");
        const requests: ClarificationRequest[] = [];
        const rejected = '{% section id="nested" title="Nested" %}Nope{% /section %}';
        const clarifier = Layer.succeed(WalkthroughClarifier, {
          selectedModel: Effect.succeed(model),
          answer: (request) => {
            requests.push(request);
            return Effect.succeed(
              request.repair === undefined || request.question === "Can repair stay invalid?"
                ? rejected
                : "The repaired **answer**.",
            );
          },
        });
        const layer = Layer.merge(contextResolverLive, clarifier).pipe(
          Layer.provideMerge(shellLayer),
        );
        const prepared = yield* prepareSession({
          cwd: repo.dir,
          selection: { kind: "files", paths: ["walkthroughs/valid.md"] },
          useGh: false,
        }).pipe(Effect.provide(layer));
        if (prepared._tag !== "SessionReady") return yield* Effect.die(prepared._tag);
        const path = prepared.session.paths[0];
        if (path === undefined) return yield* Effect.die("fixture path missing");

        yield* prepared.session.api.askQa(
          path,
          JSON.stringify({
            kind: "new",
            anchor: { sectionId: "overview", excerpt: "The planning pool is now live." },
            question: "Can this repair itself?",
          }),
        );

        const answered = yield* awaitThread(prepared.session.api, path, "answered");
        expect(answered.threads[0]?.turns[0]?.answer).toMatchObject([
          { b: "md", nodes: expect.any(Array) },
        ]);
        expect(requests).toHaveLength(2);
        expect(requests[1]?.repair).toMatchObject({
          rejectedAnswer: rejected,
          diagnostics: expect.arrayContaining([
            expect.stringContaining("cannot create walkthrough sections or groups"),
          ]),
        });

        const threadId = answered.threads[0]?.id;
        if (threadId === undefined) return yield* Effect.die("answered thread missing");
        yield* prepared.session.api.askQa(
          path,
          JSON.stringify({
            kind: "follow-up",
            threadId,
            question: "Can repair stay invalid?",
          }),
        );
        const failed = yield* awaitThread(prepared.session.api, path, "failed");
        expect(failed.threads[0]).toMatchObject({
          status: "failed",
          failed: { question: "Can repair stay invalid?" },
        });
        expect(requests).toHaveLength(4);
        expect(requests[3]?.repair).toBeDefined();
      }),
    ),
  );

  it.live("persists pending, answered, follow-up and failed states at the walkthrough stamp", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const repo = createFixtureRepo();
        yield* Effect.addFinalizer(() => Effect.sync(repo.cleanup));
        repo.addWalkthrough("valid.md", "valid.md");
        const requests: ClarificationRequest[] = [];
        let failNext = false;
        const clarifier = Layer.succeed(WalkthroughClarifier, {
          selectedModel: Effect.succeed(model),
          answer: (request) => {
            requests.push(request);
            return failNext
              ? new ClarifierRequestFailed({
                  provider: model.providerId,
                  model: model.modelId,
                  detail: "fixture provider failure",
                })
              : Effect.succeed(`The answer to **${request.question}** is pinned.`);
          },
        });
        const layer = Layer.merge(contextResolverLive, clarifier).pipe(
          Layer.provideMerge(shellLayer),
        );
        const prepared = yield* prepareSession({
          cwd: repo.dir,
          selection: { kind: "files", paths: ["walkthroughs/valid.md"] },
          useGh: false,
        }).pipe(Effect.provide(layer));
        if (prepared._tag !== "SessionReady") return yield* Effect.die(prepared._tag);
        const path = prepared.session.paths[0];
        if (path === undefined) return yield* Effect.die("fixture path missing");
        const payload = yield* prepared.session.api.walkthrough(path);
        if ("kind" in payload) return yield* Effect.die("fixture unexpectedly returned an index");

        const pending = yield* prepared.session.api.askQa(
          path,
          JSON.stringify({
            kind: "new",
            anchor: { sectionId: "overview", excerpt: "The planning pool is now live." },
            question: "Why is this pinned?",
          }),
        );
        expect(pending.threads).toMatchObject([{ status: "pending" }]);
        const answered = yield* awaitThread(prepared.session.api, path, "answered");
        expect(answered.pr).toBe(payload.pr.number);
        expect(answered.stamp).toBe(payload.commit);
        expect(answered.threads[0]?.turns[0]?.answer).toMatchObject([
          { b: "md", nodes: expect.any(Array) },
        ]);
        expect(requests[0]).toMatchObject({
          pin: payload.commit,
          base: expect.stringMatching(/^[0-9a-f]{40}$/u),
          anchor: { sectionId: "overview" },
          turns: [],
        });

        const threadId = answered.threads[0]?.id;
        if (threadId === undefined) return yield* Effect.die("answered thread missing");
        yield* prepared.session.api.askQa(
          path,
          JSON.stringify({ kind: "follow-up", threadId, question: "What changed?" }),
        );
        const followedUp = yield* awaitTurns(prepared.session.api, path, 2);
        expect(followedUp.threads[0]?.turns.map((turn) => turn.question)).toEqual([
          "Why is this pinned?",
          "What changed?",
        ]);
        expect(requests[1]?.turns).toHaveLength(1);

        failNext = true;
        yield* prepared.session.api.askQa(
          path,
          JSON.stringify({ kind: "follow-up", threadId, question: "Can this fail?" }),
        );
        const failed = yield* awaitThread(prepared.session.api, path, "failed");
        expect(failed.threads[0]).toMatchObject({
          status: "failed",
          failed: { question: "Can this fail?" },
          turns: expect.arrayContaining([
            expect.objectContaining({ question: "Why is this pinned?" }),
            expect.objectContaining({ question: "What changed?" }),
          ]),
        });
        expect(requests).toHaveLength(3);

        /* SAFETY: the assertion intentionally forgets JSON.parse's `any` result to unknown. */
        const stored = JSON.parse(
          readFileSync(join(repo.dir, ".balade", qaFileName(path)), "utf8"),
        ) as unknown;
        expect(stored).toEqual(failed);

        writeFileSync(
          join(repo.dir, ".balade", qaFileName(path)),
          JSON.stringify({ ...failed, stamp: "different-generation" }),
          "utf8",
        );
        expect(yield* prepared.session.api.readQa(path)).toEqual({
          version: 1,
          walkthrough: path,
          pr: payload.pr.number,
          stamp: payload.commit,
          threads: [],
        });
      }),
    ),
  );

  it.live("settles an in-flight clarification when the server scope closes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const repo = createFixtureRepo();
        yield* Effect.addFinalizer(() => Effect.sync(repo.cleanup));
        repo.addWalkthrough("valid.md", "valid.md");
        const clarifier = Layer.succeed(WalkthroughClarifier, {
          selectedModel: Effect.succeed(model),
          answer: () => Effect.never,
        });
        const layer = Layer.merge(contextResolverLive, clarifier).pipe(
          Layer.provideMerge(shellLayer),
        );

        const path = yield* Effect.scoped(
          Effect.gen(function* () {
            const prepared = yield* prepareSession({
              cwd: repo.dir,
              selection: { kind: "files", paths: ["walkthroughs/valid.md"] },
              useGh: false,
            }).pipe(Effect.provide(layer));
            if (prepared._tag !== "SessionReady") return yield* Effect.die(prepared._tag);
            const path = prepared.session.paths[0];
            if (path === undefined) return yield* Effect.die("fixture path missing");

            const pending = yield* prepared.session.api.askQa(
              path,
              JSON.stringify({
                kind: "new",
                anchor: { sectionId: "overview", excerpt: "The planning pool is now live." },
                question: "Will this be settled?",
              }),
            );
            expect(pending.threads).toMatchObject([{ status: "pending" }]);
            return path;
          }),
        );

        /* SAFETY: the assertion intentionally forgets JSON.parse's `any` result to unknown. */
        const stored = JSON.parse(
          readFileSync(join(repo.dir, ".balade", qaFileName(path)), "utf8"),
        ) as unknown;
        expect(stored).toMatchObject({
          threads: [
            {
              status: "failed",
              failed: { question: "Will this be settled?" },
            },
          ],
        });
      }),
    ),
  );
});

const awaitThread = Effect.fn("test.awaitQaThread")(function* (
  api: Api,
  path: string,
  status: "answered" | "failed",
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = yield* api.readQa(path);
    if (state.threads[0]?.status === status) return state;
    yield* Effect.sleep("10 millis");
  }
  return yield* Effect.die(`clarification did not reach ${status}`);
});

const awaitTurns = Effect.fn("test.awaitQaTurns")(function* (
  api: Api,
  path: string,
  count: number,
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = yield* api.readQa(path);
    if (state.threads[0]?.turns.length === count) return state;
    yield* Effect.sleep("10 millis");
  }
  return yield* Effect.die(`clarification did not reach ${count} turns`);
});
