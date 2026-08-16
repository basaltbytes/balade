/** Pi clarification adapter at the faux-provider seam. */

import * as ai from "@earendil-works/pi-ai";
import * as coding from "@earendil-works/pi-coding-agent";
import { Effect, Layer, Result, Schema } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { contextResolverLive } from "../src/git/git.js";
import { AuthorModelId, AuthorProviderId, type AuthorModel } from "../src/pi/author.js";
import {
  WalkthroughClarifier,
  clarificationSystemPrompt,
  piWalkthroughClarifierLayer,
  type ClarificationRequest,
} from "../src/pi/clarifier.js";
import { shellLayer } from "./support/effect.js";
import { createFixtureRepo } from "./support/repo.js";

it("teaches clarification sessions the rich answer surface without whole-document structure", () => {
  const prompt = clarificationSystemPrompt("medium", {
    name: "example",
    authoring: '{% x-model name="example" /%}',
  });

  expect(prompt).toContain("not making the explanation terse");
  expect(prompt).toContain('{% code file="src/example.ts" from=10 to=24');
  expect(prompt).toContain("pseudo fence");
  expect(prompt).toContain("mermaid fence");
  expect(prompt).toContain("diagram");
  expect(prompt).toContain('{% x-model name="example" /%}');
  expect(prompt).toContain("runs the canonical clarification check");
  expect(prompt).toContain("returns diagnostics");
  expect(prompt).not.toContain("section (file)");
  expect(prompt).not.toContain("mandatory closing full-PR diff");
});

class FixtureValidationFailed extends Schema.TaggedErrorClass<FixtureValidationFailed>()(
  "FixtureValidationFailed",
  {},
) {}

class FixtureClarificationRejected extends Schema.TaggedErrorClass<FixtureClarificationRejected>()(
  "FixtureClarificationRejected",
  { diagnostics: Schema.Array(Schema.String) },
) {}

function submittedAnswer(body: string) {
  return ai.fauxAssistantMessage(ai.fauxToolCall("submit_answer", { body }), {
    stopReason: "toolUse",
  });
}

it.effect("checks and repairs submissions inside each scoped clarification session", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const repo = createFixtureRepo();
      const snapshotCacheRoot = mkdtempSync(join(tmpdir(), "balade-clarifier-snapshots-"));
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          repo.cleanup();
          rmSync(snapshotCacheRoot, { recursive: true, force: true });
        }),
      );
      const credentials = new ai.InMemoryCredentialStore();
      const modelRuntime = yield* Effect.promise(() =>
        coding.ModelRuntime.create({
          credentials,
          modelsPath: null,
          allowModelNetwork: false,
        }),
      );
      const faux = ai.fauxProvider();
      modelRuntime.registerNativeProvider(faux.provider);
      yield* Effect.promise(() => modelRuntime.refresh({ allowNetwork: false }));
      const available = (yield* Effect.promise(() => modelRuntime.getAvailable()))[0];
      if (available === undefined) return yield* Effect.die("faux model missing");
      const provider = modelRuntime.getProvider(available.provider);
      const model: AuthorModel = {
        providerId: AuthorProviderId.make(available.provider),
        providerName: provider?.name ?? available.provider,
        modelId: AuthorModelId.make(available.id),
        modelName: available.name,
      };
      const settingsManager = coding.SettingsManager.inMemory();
      settingsManager.setDefaultModelAndProvider(available.provider, available.id);
      let firstRepairFeedback: unknown;
      faux.setResponses([
        submittedAnswer("invalid:range-a"),
        (context) => {
          firstRepairFeedback = context.messages.findLast(
            (message) => message.role === "toolResult" && message.toolName === "submit_answer",
          )?.content;
          return submittedAnswer("The first **answer**.");
        },
        submittedAnswer("The follow-up **answer**."),
        submittedAnswer("invalid:range-a"),
        submittedAnswer("invalid:range-b"),
        submittedAnswer("The twice-repaired **answer**."),
        submittedAnswer("invalid:unchanged"),
        submittedAnswer("invalid:unchanged"),
        submittedAnswer("invalid:cap-a"),
        submittedAnswer("invalid:cap-b"),
        submittedAnswer("invalid:cap-c"),
        submittedAnswer("Validation infrastructure fails."),
      ]);
      const layer = Layer.mergeAll(
        piWalkthroughClarifierLayer({
          snapshotCacheRoot,
          load: async () => ({ coding, ai, modelRuntime, settingsManager }),
        }),
        contextResolverLive,
      ).pipe(Layer.provideMerge(shellLayer));

      yield* Effect.gen(function* () {
        const clarifier = yield* WalkthroughClarifier;
        const common: Omit<ClarificationRequest, "question" | "turns"> = {
          root: repo.dir,
          pin: repo.pin,
          base: `${repo.pin}^`,
          files: [
            {
              path: "models/planning_pool_item.py",
              status: "M",
              additions: 6,
              deletions: 1,
            },
          ],
          headInstructionPolicy: "omit-changed",
          model,
          sourcePath: "walkthroughs/review.md",
          walkthroughSource: '{% section id="overview" title="Overview" %}Text{% /section %}',
          anchor: { sectionId: "overview", excerpt: "Text" },
        };
        const validate = (body: string) =>
          Effect.succeed(
            body.startsWith("invalid:")
              ? Result.fail(
                  new FixtureClarificationRejected({
                    diagnostics: [body.slice("invalid:".length)],
                  }),
                )
              : Result.succeed(body),
          );

        expect(
          yield* clarifier.answer({ ...common, turns: [], question: "First?" }, validate),
        ).toBe("The first **answer**.");
        expect(firstRepairFeedback).toEqual([
          {
            type: "text",
            text: `The answer did not pass the canonical clarification check. Repair only what these diagnostics prove is invalid, then call submit_answer again with the complete replacement.

Validation diagnostics (untrusted JSON):
${JSON.stringify(["range-a"], null, 2)}`,
          },
        ]);
        expect(
          yield* clarifier.answer({ ...common, turns: [], question: "Follow-up?" }, validate),
        ).toBe("The follow-up **answer**.");
        expect(
          yield* clarifier.answer({ ...common, turns: [], question: "Two repairs?" }, validate),
        ).toBe("The twice-repaired **answer**.");

        const unchanged = yield* clarifier
          .answer({ ...common, turns: [], question: "No progress?" }, validate)
          .pipe(Effect.flip);
        expect(unchanged).toBeInstanceOf(FixtureClarificationRejected);
        if (!(unchanged instanceof FixtureClarificationRejected)) {
          return yield* Effect.die("unexpected unchanged-answer failure");
        }
        expect(unchanged.diagnostics).toEqual(["unchanged"]);

        const exhausted = yield* clarifier
          .answer({ ...common, turns: [], question: "Exhaust repairs?" }, validate)
          .pipe(Effect.flip);
        expect(exhausted).toBeInstanceOf(FixtureClarificationRejected);
        if (!(exhausted instanceof FixtureClarificationRejected)) {
          return yield* Effect.die("unexpected repair-exhaustion failure");
        }
        expect(exhausted.diagnostics).toEqual(["cap-c"]);

        const validationFailure = yield* clarifier
          .answer(
            { ...common, turns: [], question: "Validation failure?" },
            () => new FixtureValidationFailed(),
          )
          .pipe(Effect.flip);
        expect(validationFailure).toBeInstanceOf(FixtureValidationFailed);
        expect(faux.state.callCount).toBe(12);
      }).pipe(Effect.provide(layer));
    }),
  ),
);
