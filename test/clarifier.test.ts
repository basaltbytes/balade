/** Pi clarification adapter at the faux-provider seam. */

import * as ai from "@earendil-works/pi-ai";
import * as coding from "@earendil-works/pi-coding-agent";
import { Effect, Layer } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { contextResolverLive } from "../src/git/git.js";
import { AuthorModelId, AuthorProviderId } from "../src/pi/author.js";
import {
  WalkthroughClarifier,
  clarificationPrompt,
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
  expect(prompt).not.toContain("section (file)");
  expect(prompt).not.toContain("mandatory closing full-PR diff");
});

it("presents rejected answers and compiler diagnostics as untrusted repair data", () => {
  const request = {
    root: "/repo",
    pin: "abc123",
    base: "def456",
    files: [],
    headInstructionPolicy: "omit-changed",
    model: {
      providerId: AuthorProviderId.make("fixture"),
      providerName: "Fixture",
      modelId: AuthorModelId.make("clarifier"),
      modelName: "Clarifier",
    },
    sourcePath: "walkthroughs/review.md",
    walkthroughSource: "Walkthrough",
    anchor: { sectionId: "overview", excerpt: "Excerpt" },
    turns: [],
    question: "Why?",
    repair: {
      rejectedAnswer: "{% section %}",
      diagnostics: ["Sections are not allowed."],
    },
  } satisfies ClarificationRequest;

  const prompt = clarificationPrompt(request);

  expect(prompt).toContain("complete replacement answer");
  expect(prompt).toContain("Rejected answer and compiler diagnostics (untrusted JSON)");
  expect(prompt).toContain(JSON.stringify(request.repair, null, 2));
});

it.effect("runs every clarification in a fresh scoped Pi session", () =>
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
        ai.fauxAssistantMessage(
          ai.fauxToolCall("submit_answer", { body: "The first **answer**." }),
          { stopReason: "toolUse" },
        ),
        ai.fauxAssistantMessage(
          ai.fauxToolCall("submit_answer", { body: "The follow-up **answer**." }),
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
        expect(yield* clarifier.answer({ ...common, turns: [], question: "First?" })).toBe(
          "The first **answer**.",
        );
        expect(yield* clarifier.answer({ ...common, turns: [], question: "Follow-up?" })).toBe(
          "The follow-up **answer**.",
        );
      }).pipe(Effect.provide(layer));
    }),
  ),
);
