/** Pi clarification adapter at the faux-provider seam. */

import * as ai from "@earendil-works/pi-ai";
import * as coding from "@earendil-works/pi-coding-agent";
import { Effect, Layer, Result, Schema } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { contextResolverLive } from "../src/git/git.js";
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
      const settingsManager = coding.SettingsManager.inMemory();
      settingsManager.setDefaultModelAndProvider(available.provider, available.id);
      faux.setResponses([
        ai.fauxAssistantMessage(ai.fauxToolCall("submit_answer", { body: "invalid:range-a" }), {
          stopReason: "toolUse",
        }),
        ai.fauxAssistantMessage(
          ai.fauxToolCall("submit_answer", { body: "The first **answer**." }),
          { stopReason: "toolUse" },
        ),
        ai.fauxAssistantMessage(
          ai.fauxToolCall("submit_answer", { body: "The follow-up **answer**." }),
          { stopReason: "toolUse" },
        ),
        ai.fauxAssistantMessage(ai.fauxToolCall("submit_answer", { body: "invalid:range-a" }), {
          stopReason: "toolUse",
        }),
        ai.fauxAssistantMessage(ai.fauxToolCall("submit_answer", { body: "invalid:range-b" }), {
          stopReason: "toolUse",
        }),
        ai.fauxAssistantMessage(
          ai.fauxToolCall("submit_answer", { body: "The twice-repaired **answer**." }),
          { stopReason: "toolUse" },
        ),
        ai.fauxAssistantMessage(ai.fauxToolCall("submit_answer", { body: "invalid:unchanged" }), {
          stopReason: "toolUse",
        }),
        ai.fauxAssistantMessage(ai.fauxToolCall("submit_answer", { body: "invalid:unchanged" }), {
          stopReason: "toolUse",
        }),
        ai.fauxAssistantMessage(
          ai.fauxToolCall("submit_answer", { body: "Validation infrastructure fails." }),
          { stopReason: "toolUse" },
        ),
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
        const model = yield* clarifier.selectedModel;
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
              ? Result.fail({ diagnostics: [body.slice("invalid:".length)] })
              : Result.succeed(body),
          );

        expect(
          yield* clarifier.answer({ ...common, turns: [], question: "First?" }, validate),
        ).toBe("The first **answer**.");
        expect(
          yield* clarifier.answer({ ...common, turns: [], question: "Follow-up?" }, validate),
        ).toBe("The follow-up **answer**.");
        expect(
          yield* clarifier.answer({ ...common, turns: [], question: "Two repairs?" }, validate),
        ).toBe("The twice-repaired **answer**.");

        const unchanged = yield* clarifier
          .answer({ ...common, turns: [], question: "No progress?" }, validate)
          .pipe(Effect.flip);
        expect(unchanged).toEqual({ diagnostics: ["unchanged"] });

        const validationFailure = yield* clarifier
          .answer(
            { ...common, turns: [], question: "Validation failure?" },
            () => new FixtureValidationFailed(),
          )
          .pipe(Effect.flip);
        expect(validationFailure).toBeInstanceOf(FixtureValidationFailed);
        expect(faux.state.callCount).toBe(9);
      }).pipe(Effect.provide(layer));
    }),
  ),
);
