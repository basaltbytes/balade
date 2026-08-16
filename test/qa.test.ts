/** Clarification workflow through real git resolution and file sidecars, with Pi at its port. */

import { Effect, Layer, Result } from "effect";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import {
  AgentModelManager,
  AgentModelReady,
  AgentModelSelectionCancelled,
  AgentModelSetupRequired,
} from "../src/agent/model.js";
import { contextResolverLive } from "../src/git/git.js";
import { AuthorModelId, AuthorProviderId, type AuthorModel } from "../src/pi/author.js";
import {
  ClarifierRequestFailed,
  WalkthroughClarifier,
  type ClarificationRequest,
} from "../src/pi/clarifier.js";
import type { Api } from "../src/server/api.js";
import { prepareSession } from "../src/server/session.js";
import { qaFilePath } from "../src/state.js";
import { shellLayer } from "./support/effect.js";
import { createFixtureRepo } from "./support/repo.js";

const model: AuthorModel = {
  providerId: AuthorProviderId.make("fixture"),
  providerName: "Fixture",
  modelId: AuthorModelId.make("clarifier"),
  modelName: "Clarifier",
};

const agentModels = Layer.succeed(AgentModelManager, {
  status: Effect.succeed(new AgentModelReady({ model })),
  ensure: Effect.succeed(model),
  configure: () => Effect.succeed(model),
  logout: Effect.void,
});

describe("the clarification workflow", () => {
  it.live("does not persist a pending question when agent setup is cancelled", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const repo = createFixtureRepo();
        yield* Effect.addFinalizer(() => Effect.sync(repo.cleanup));
        repo.addWalkthrough("valid.md", "valid.md");
        const setupCancelled = Layer.succeed(AgentModelManager, {
          status: Effect.succeed(new AgentModelSetupRequired()),
          ensure: new AgentModelSelectionCancelled(),
          configure: () => Effect.die("explicit setup is outside this fixture"),
          logout: Effect.void,
        });
        const clarifier = Layer.succeed(WalkthroughClarifier, {
          answer: () => Effect.die("clarification must not start before setup finishes"),
        });
        const layer = Layer.mergeAll(contextResolverLive, clarifier, setupCancelled).pipe(
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
        const generation = yield* qaGeneration(prepared.session.api, path);

        const error = yield* Effect.flip(
          prepared.session.api.askQa(
            path,
            JSON.stringify({
              kind: "new",
              generation,
              anchor: { sectionId: "overview", excerpt: "The planning pool is now live." },
              question: "Can setup be cancelled?",
            }),
          ),
        );

        expect(error).toMatchObject({
          _tag: "QaAgentUnavailable",
          reason: "setup-cancelled",
        });
        expect((yield* prepared.session.api.readQa(path)).threads).toEqual([]);
        expect(existsSync(join(repo.dir, ".balade", qaFilePath(path)))).toBe(false);
      }),
    ),
  );

  it.live("rejects a question when setup outlives the displayed generation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const repo = createFixtureRepo();
        yield* Effect.addFinalizer(() => Effect.sync(repo.cleanup));
        repo.addWalkthrough("valid.md", "valid.md");
        let replacementStamp: string | undefined;
        let clarificationStarted = false;
        const changingModels = Layer.succeed(AgentModelManager, {
          status: Effect.succeed(new AgentModelSetupRequired()),
          ensure: Effect.sync(() => {
            repo.write("models/planning_pool_item.py", "# changed while setup was open\n");
            replacementStamp = repo.commit("feat: replace displayed generation");
            const file = join(repo.dir, "walkthroughs/valid.md");
            writeFileSync(
              file,
              readFileSync(file, "utf8").replace(repo.pin, replacementStamp),
              "utf8",
            );
            return model;
          }),
          configure: () => Effect.succeed(model),
          logout: Effect.void,
        });
        const clarifier = Layer.succeed(WalkthroughClarifier, {
          answer: () => {
            clarificationStarted = true;
            return Effect.die("stale clarification must not start");
          },
        });
        const layer = Layer.mergeAll(contextResolverLive, clarifier, changingModels).pipe(
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
        const generation = yield* qaGeneration(prepared.session.api, path);

        const error = yield* Effect.flip(
          prepared.session.api.askQa(
            path,
            JSON.stringify({
              kind: "new",
              generation,
              anchor: { sectionId: "overview", excerpt: "The planning pool is now live." },
              question: "Which generation is this?",
            }),
          ),
        );

        expect(error).toMatchObject({
          _tag: "QaGenerationChanged",
          expected: generation,
          actual: { pr: generation.pr, stamp: replacementStamp },
        });
        expect(clarificationStarted).toBe(false);
        expect(existsSync(join(repo.dir, ".balade", qaFilePath(path)))).toBe(false);
      }),
    ),
  );

  it.live("recovers a pending question whose worker did not survive a restart", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const repo = createFixtureRepo();
        yield* Effect.addFinalizer(() => Effect.sync(repo.cleanup));
        repo.addWalkthrough("valid.md", "valid.md");
        const clarifier = Layer.succeed(WalkthroughClarifier, {
          answer: () => Effect.die("recovered work must not start a new clarification"),
        });
        const layer = Layer.mergeAll(contextResolverLive, clarifier, agentModels).pipe(
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
        const generation = yield* qaGeneration(prepared.session.api, path);
        const file = join(repo.dir, ".balade", qaFilePath(path));
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(
          file,
          JSON.stringify({
            version: 1,
            walkthrough: path,
            ...generation,
            threads: [
              {
                id: "34d91d9f-21f4-4c3b-9b72-b1f76166395c",
                anchor: { sectionId: "overview", excerpt: "The planning pool is now live." },
                status: "pending",
                turns: [],
                pending: {
                  id: "57992f39-f492-4b7c-8580-d2483916bba2",
                  question: "Did the worker survive?",
                  askedAt: "2026-08-16T08:00:00.000Z",
                },
              },
            ],
          }),
          "utf8",
        );

        const recovered = yield* prepared.session.api.readQa(path);

        expect(recovered.threads).toMatchObject([
          {
            status: "failed",
            failed: { question: "Did the worker survive?" },
          },
        ]);
        /* SAFETY: the assertion intentionally forgets JSON.parse's `any` result to unknown. */
        expect(JSON.parse(readFileSync(file, "utf8")) as unknown).toEqual(recovered);
      }),
    ),
  );

  it.live("keeps canonical validation inside one clarification call", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const repo = createFixtureRepo();
        yield* Effect.addFinalizer(() => Effect.sync(repo.cleanup));
        repo.addWalkthrough("valid.md", "valid.md");
        const requests: ClarificationRequest[] = [];
        const rejections: (readonly string[])[] = [];
        let configured = false;
        const firstQuestionAgentModels = Layer.succeed(AgentModelManager, {
          status: Effect.sync(() =>
            configured ? new AgentModelReady({ model }) : new AgentModelSetupRequired(),
          ),
          ensure: Effect.sync(() => {
            configured = true;
            return model;
          }),
          configure: () => Effect.succeed(model),
          logout: Effect.void,
        });
        const rejected = '{% section id="nested" title="Nested" %}Nope{% /section %}';
        const clarifier = Layer.succeed(WalkthroughClarifier, {
          answer: (request, validate) =>
            Effect.gen(function* () {
              requests.push(request);
              const first = yield* validate(rejected);
              if (Result.isSuccess(first)) return yield* Effect.die("invalid fixture was accepted");
              rejections.push(first.failure.diagnostics);
              const replacement =
                request.question === "Can repair stay invalid?"
                  ? rejected
                  : "The repaired **answer**.";
              return yield* Effect.fromResult(yield* validate(replacement));
            }),
        });
        const layer = Layer.mergeAll(contextResolverLive, clarifier, firstQuestionAgentModels).pipe(
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
        const generation = yield* qaGeneration(prepared.session.api, path);
        expect(yield* prepared.session.api.agentStatus).toEqual({ status: "setup-required" });

        yield* prepared.session.api.askQa(
          path,
          JSON.stringify({
            kind: "new",
            generation,
            anchor: { sectionId: "overview", excerpt: "The planning pool is now live." },
            question: "Can this repair itself?",
          }),
        );

        const answered = yield* awaitThread(prepared.session.api, path, "answered");
        expect(configured).toBe(true);
        expect(yield* prepared.session.api.agentStatus).toEqual({ status: "ready" });
        expect(answered.threads[0]?.turns[0]?.answer).toMatchObject([
          { b: "md", nodes: expect.any(Array) },
        ]);
        expect(requests).toHaveLength(1);
        expect(rejections[0]).toEqual(
          expect.arrayContaining([
            expect.stringContaining("cannot create walkthrough sections, groups, or file browsers"),
          ]),
        );

        const threadId = answered.threads[0]?.id;
        if (threadId === undefined) return yield* Effect.die("answered thread missing");
        yield* prepared.session.api.askQa(
          path,
          JSON.stringify({
            kind: "follow-up",
            generation,
            threadId,
            question: "Can repair stay invalid?",
          }),
        );
        const failed = yield* awaitThread(prepared.session.api, path, "failed");
        expect(failed.threads[0]).toMatchObject({
          status: "failed",
          failed: { question: "Can repair stay invalid?" },
        });
        expect(requests).toHaveLength(2);
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
          answer: (request, validate) => {
            requests.push(request);
            return failNext
              ? new ClarifierRequestFailed({
                  provider: model.providerId,
                  model: model.modelId,
                  detail: "fixture provider failure",
                })
              : validate(`The answer to **${request.question}** is pinned.`).pipe(
                  Effect.flatMap(Effect.fromResult),
                );
          },
        });
        const layer = Layer.mergeAll(contextResolverLive, clarifier, agentModels).pipe(
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
        const generation = { pr: payload.pr.number, stamp: payload.commit };

        const pending = yield* prepared.session.api.askQa(
          path,
          JSON.stringify({
            kind: "new",
            generation,
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
          JSON.stringify({ kind: "follow-up", generation, threadId, question: "What changed?" }),
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
          JSON.stringify({
            kind: "follow-up",
            generation,
            threadId,
            question: "Can this fail?",
          }),
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
          readFileSync(join(repo.dir, ".balade", qaFilePath(path)), "utf8"),
        ) as unknown;
        expect(stored).toEqual(failed);

        writeFileSync(
          join(repo.dir, ".balade", qaFilePath(path)),
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
          answer: () => Effect.never,
        });
        const layer = Layer.mergeAll(contextResolverLive, clarifier, agentModels).pipe(
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
            const generation = yield* qaGeneration(prepared.session.api, path);

            const pending = yield* prepared.session.api.askQa(
              path,
              JSON.stringify({
                kind: "new",
                generation,
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
          readFileSync(join(repo.dir, ".balade", qaFilePath(path)), "utf8"),
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

const qaGeneration = Effect.fn("test.qaGeneration")(function* (api: Api, path: string) {
  const payload = yield* api.walkthrough(path);
  if ("kind" in payload) return yield* Effect.die("fixture unexpectedly returned an index");
  return { pr: payload.pr.number, stamp: payload.commit };
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
