/** Pi-backed generation through Pi's faux provider and real fixture repositories. */

import * as ai from "@earendil-works/pi-ai";
import * as coding from "@earendil-works/pi-coding-agent";
import { Effect, Fiber, Layer, Option, Redacted, Schema, Terminal } from "effect";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import {
  AuthorModel as AuthorModelSchema,
  WalkthroughAuthor,
  type AuthorModel,
  type AuthoringRequest,
  type AuthorProgress,
} from "../src/pi/author.js";
import { piWalkthroughAuthorLayer } from "../src/pi/client.js";
import { authoringSystemPrompt } from "../src/pi/authoring.js";
import { inspectionBudget } from "../src/authoring/package.js";
import { renderDraft, runGeneration } from "../src/commands/generate/pipeline.js";
import { slugifyTitle, type ExistingWalkthrough } from "../src/commands/generate/output.js";
import {
  matchingModels,
  modelSelectionFromFlags,
  modelsForPicker,
  preferredModel,
} from "../src/commands/generate/selection.js";
import { shellLayer } from "./support/effect.js";
import { contextResolverLive } from "../src/git/git.js";
import type { PullSnapshot } from "../src/git/pr.js";
import { createFixtureRepo } from "./support/repo.js";

const PINNED_LINE = "from odoo import api, fields, models";
const CHANGED_FILE = {
  path: "models/planning_pool_item.py",
  status: "M" as const,
  additions: 6,
  deletions: 1,
};

async function piHarness(registerFaux = true, settingsManager = coding.SettingsManager.inMemory()) {
  const snapshotCacheRoot = mkdtempSync(join(tmpdir(), "balade-pi-snapshots-"));
  harnessCleanups.push(() =>
    rmSync(snapshotCacheRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  );
  const credentials = new ai.InMemoryCredentialStore();
  const modelRuntime = await coding.ModelRuntime.create({
    credentials,
    modelsPath: null,
    allowModelNetwork: false,
  });
  const faux = ai.fauxProvider();
  if (registerFaux) {
    modelRuntime.registerNativeProvider(faux.provider);
    await modelRuntime.refresh({ allowNetwork: false });
  }
  const layer = Layer.mergeAll(
    piWalkthroughAuthorLayer({
      snapshotCacheRoot,
      load: async () => ({ coding, ai, modelRuntime, settingsManager }),
    }),
    contextResolverLive,
  ).pipe(Layer.provideMerge(shellLayer));
  return { credentials, faux, layer, modelRuntime, settingsManager, snapshotCacheRoot };
}

const harnessCleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of harnessCleanups.splice(0)) cleanup();
});

const fixture = Effect.acquireRelease(Effect.sync(createFixtureRepo), (repo) =>
  Effect.sync(() => repo.cleanup()),
);

function authorRequest(
  root: string,
  pin: string,
  model: AuthorModel,
  progress: (event: AuthorProgress) => void = () => {},
  progressMode: "compact" | "verbose" = "compact",
): AuthoringRequest {
  return {
    root,
    pin,
    base: `${pin}^`,
    pull: {
      number: 42,
      url: "https://github.com/acme/planning/pull/42",
      author: "reviewer",
      base: "main",
      head: "feature/pool",
      commits: 1,
    },
    claims: {
      github: Option.none(),
      commitSubjects: ["feat: live planning pool items"],
    },
    files: [CHANGED_FILE],
    model,
    headInstructionPolicy: "omit-changed",
    progressMode,
    progress,
  };
}

function prepared(root: string, pin: string): PullSnapshot {
  return {
    root,
    repoSlug: "acme/planning",
    pin,
    base: `${pin}^`,
    head: pin,
    pull: {
      number: 42,
      url: "https://github.com/acme/planning/pull/42",
      author: "reviewer",
      state: "open",
      base: "main",
      head: "feature/pool",
      commits: 1,
      stats: { files: 1, additions: 6, deletions: 1 },
    },
    claims: {
      github: Option.none(),
      commitSubjects: ["feat: live planning pool items"],
    },
    files: [{ ...CHANGED_FILE, binary: false }],
    notices: [],
  };
}

function submitted(body: string, title = "Live planning pool") {
  return ai.fauxAssistantMessage(
    ai.fauxToolCall("submit_walkthrough", {
      title,
      meta: { lang: "en", module: "acme_planning" },
      body,
    }),
    { stopReason: "toolUse" },
  );
}

const validBody = `{% section id="pool-model" title="Pool model" %}

The pool model computes live placement from slots.

{% code file="models/planning_pool_item.py" from=1 to=8 expect="${PINNED_LINE}" /%}

{% /section %}

{% section id="files" title="Full PR diff" %}

{% files /%}

{% /section %}`;

const invalidBody = `{% section id="pool-model" title="Pool model" %}

{% code file="models/planning_pool_item.py" from=999 to=1000 expect="not there" /%}

{% /section %}

{% section id="files" title="Full PR diff" %}

{% files /%}

{% /section %}`;

const fauxModel = Effect.fn("test.fauxModel")(function* () {
  const author = yield* WalkthroughAuthor;
  const model = (yield* author.availableModels).find(
    (candidate) => candidate.providerId === "faux",
  );
  if (model === undefined) return yield* Effect.die("Faux model was not available");
  return model;
});

describe("the Pi adapter", () => {
  it.effect("reads source at the pin and receives a structured submission", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      const harness = yield* Effect.promise(() => piHarness());
      repo.write(".env", "DATABASE_URL=postgres://reviewer-secret\n");
      const pin = repo.commit("test: add a credential read fixture at the pin");
      repo.write("models/planning_pool_item.py", "working tree content only\n");
      let secondRequest = "";
      const progress: AuthorProgress[] = [];
      harness.faux.setResponses([
        ai.fauxAssistantMessage(
          [
            ai.fauxText("Inspecting the pinned source."),
            ai.fauxToolCall("read_source", {
              path: "models/planning_pool_item.py",
              from: 1,
              to: 3,
            }),
            ai.fauxToolCall("read_source", { path: ".env", from: 1, to: 1 }),
          ],
          { stopReason: "toolUse" },
        ),
        (context) => {
          secondRequest = JSON.stringify({ messages: context.messages, tools: context.tools });
          return submitted(validBody);
        },
      ]);

      const turn = yield* Effect.gen(function* () {
        const author = yield* WalkthroughAuthor;
        const model = yield* fauxModel();
        const session = yield* author.start(
          authorRequest(repo.dir, pin, model, (event) => progress.push(event), "verbose"),
        );
        return session.initial;
      }).pipe(Effect.scoped, Effect.provide(harness.layer));

      expect(turn.draft.title).toBe("Live planning pool");
      expect(turn.usage.total).toBeGreaterThan(0);
      expect(secondRequest).toContain(PINNED_LINE);
      expect(secondRequest).not.toContain("working tree content only");
      expect(secondRequest).toContain(".env is not a contained repo-relative path");
      expect(secondRequest).not.toContain("reviewer-secret");
      expect(secondRequest).toContain("submit_walkthrough");
      expect(secondRequest).not.toContain('"bash"');
      expect(secondRequest).not.toContain('"write_file"');
      expect(authoringSystemPrompt(inspectionBudget(1, "medium"))).toContain(
        "no more than 16 diff reads",
      );
      expect(authoringSystemPrompt(inspectionBudget(1, "high"))).toContain("no inspection budget");
      expect(progress).toContainEqual({
        _tag: "AuthorAssistantText",
        text: "Inspecting the pinned source.",
      });
      expect(progress).toContainEqual({
        _tag: "AuthorToolStarted",
        name: "read_source",
        input: '{"path":"models/planning_pool_item.py","from":1,"to":3}',
      });
      expect(progress).toContainEqual(
        expect.objectContaining({
          _tag: "AuthorToolFinished",
          name: "read_source",
          output: expect.stringContaining(PINNED_LINE),
          failed: false,
        }),
      );
    }),
  );

  it.effect("searches the pinned snapshot and can read the old implementation", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      const harness = yield* Effect.promise(() => piHarness());
      const pinnedSource = readFileSync(join(repo.dir, "models/planning_pool_item.py"), "utf8");
      const baseSource = execFileSync(
        "git",
        ["show", `${repo.pin}^:models/planning_pool_item.py`],
        { cwd: repo.dir, encoding: "utf8" },
      );
      repo.write(".env", "DATABASE_URL=postgres://base-secret\n");
      repo.write("models/planning_pool_item.py", baseSource);
      repo.commit("test: add a credential read fixture at the base");
      repo.write("models/planning_pool_item.py", pinnedSource);
      const pin = repo.commit("test: create a pin above the credential fixture");
      repo.write("models/planning_slot.py", "dirty working tree only\n");
      let searchContext = "";
      let baseContext = "";
      harness.faux.setResponses([
        ai.fauxAssistantMessage(
          ai.fauxToolCall("search_source", {
            query: "planning.slot",
            mode: "fixed",
          }),
          { stopReason: "toolUse" },
        ),
        (context) => {
          searchContext = JSON.stringify({ messages: context.messages, tools: context.tools });
          return ai.fauxAssistantMessage(
            [
              ai.fauxToolCall("read_base_source", {
                path: "models/planning_pool_item.py",
                from: 1,
                to: 4,
              }),
              ai.fauxToolCall("read_base_source", { path: ".env", from: 1, to: 1 }),
            ],
            { stopReason: "toolUse" },
          );
        },
        (context) => {
          baseContext = JSON.stringify(context.messages);
          return submitted(validBody);
        },
      ]);

      yield* Effect.gen(function* () {
        const author = yield* WalkthroughAuthor;
        const model = yield* fauxModel();
        yield* author.start(authorRequest(repo.dir, pin, model));
      }).pipe(Effect.scoped, Effect.provide(harness.layer));

      expect(searchContext).toContain("models/planning_allocation.py");
      expect(searchContext).toContain("models/planning_slot.py");
      expect(searchContext.indexOf("models/planning_allocation.py")).toBeLessThan(
        searchContext.indexOf("models/planning_slot.py"),
      );
      expect(searchContext).not.toContain("dirty working tree only");
      expect(searchContext).toContain('"name":"search_source"');
      expect(searchContext).toContain('"name":"read_base_source"');
      expect(searchContext).not.toContain('"name":"grep"');
      expect(baseContext).toContain("from odoo import fields, models");
      expect(baseContext).not.toContain("from odoo import api, fields, models");
      expect(baseContext).toContain(".env is not a contained repo-relative path");
      expect(baseContext).not.toContain("base-secret");
    }),
  );

  it.effect("caps search results with balade-owned guidance", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      const harness = yield* Effect.promise(() => piHarness());
      repo.write(
        "models/search_limit.py",
        Array.from({ length: 205 }, (_, index) => `needle_${index} = "needle"`).join("\n"),
      );
      const pin = repo.commit("test: add enough matches to reach the search cap");
      let searchContext = "";
      harness.faux.setResponses([
        ai.fauxAssistantMessage(
          ai.fauxToolCall("search_source", {
            query: "needle",
            mode: "fixed",
            path: "models/search_limit.py",
          }),
          { stopReason: "toolUse" },
        ),
        (context) => {
          searchContext = JSON.stringify(context.messages);
          return submitted(validBody);
        },
      ]);

      yield* Effect.gen(function* () {
        const author = yield* WalkthroughAuthor;
        const model = yield* fauxModel();
        yield* author.start(authorRequest(repo.dir, pin, model));
      }).pipe(Effect.scoped, Effect.provide(harness.layer));

      expect(searchContext).toContain("200 matches shown; narrow the query or path to continue");
      expect(searchContext).not.toContain("Use limit=400");
    }),
  );

  it.effect("sorts matches by path and line despite colons in match text", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      const harness = yield* Effect.promise(() => piHarness());
      repo.write(
        "models/colon_sort.py",
        [
          "# colon sort fixture",
          'first = "sortneedle 00:30:59"',
          ...Array.from({ length: 7 }, (_, index) => `filler_${index} = ${index}`),
          'second = "sortneedle"',
        ].join("\n"),
      );
      const pin = repo.commit("test: add colon-bearing match text");
      let searchContext = "";
      harness.faux.setResponses([
        ai.fauxAssistantMessage(
          ai.fauxToolCall("search_source", {
            query: "sortneedle",
            mode: "fixed",
            path: "models/colon_sort.py",
          }),
          { stopReason: "toolUse" },
        ),
        (context) => {
          searchContext = JSON.stringify(context.messages);
          return submitted(validBody);
        },
      ]);

      yield* Effect.gen(function* () {
        const author = yield* WalkthroughAuthor;
        const model = yield* fauxModel();
        yield* author.start(authorRequest(repo.dir, pin, model));
      }).pipe(Effect.scoped, Effect.provide(harness.layer));

      const second = searchContext.indexOf("models/colon_sort.py:2:");
      const tenth = searchContext.indexOf("models/colon_sort.py:10:");
      expect(second).toBeGreaterThan(-1);
      expect(tenth).toBeGreaterThan(-1);
      expect(second).toBeLessThan(tenth);
    }),
  );

  it.effect("keeps concurrent searches on the balade ripgrep configuration", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      const harness = yield* Effect.promise(() => piHarness());
      const outside = mkdtempSync(join(tmpdir(), "balade-outside-"));
      harnessCleanups.push(() =>
        rmSync(outside, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
      );
      writeFileSync(
        join(outside, "secret.py"),
        'leaked = "planning.slot LEAKED_OUTSIDE"\n',
        "utf8",
      );
      symlinkSync(join(outside, "secret.py"), join(repo.dir, "leak_link.py"));
      const pin = repo.commit("test: add escaping search symlink");
      /* A hostile user config: follow symlinks out, filter the real matches away. */
      const userConfiguration = join(outside, "rg.conf");
      writeFileSync(userConfiguration, "--follow\n--glob=!models/*\n", "utf8");
      const previous = process.env.RIPGREP_CONFIG_PATH;
      harnessCleanups.push(() => {
        if (previous === undefined) delete process.env.RIPGREP_CONFIG_PATH;
        else process.env.RIPGREP_CONFIG_PATH = previous;
      });
      process.env.RIPGREP_CONFIG_PATH = userConfiguration;
      let searchContext = "";
      harness.faux.setResponses([
        ai.fauxAssistantMessage(
          [
            ai.fauxToolCall("search_source", {
              query: "planning.slot",
              mode: "fixed",
              path: "models/planning_slot.py",
            }),
            ai.fauxToolCall("search_source", {
              query: "planning.pool.item",
              mode: "fixed",
              path: "models/planning_pool_item.py",
            }),
          ],
          { stopReason: "toolUse" },
        ),
        (context) => {
          searchContext = JSON.stringify(context.messages);
          return submitted(validBody);
        },
      ]);

      yield* Effect.gen(function* () {
        const author = yield* WalkthroughAuthor;
        const model = yield* fauxModel();
        yield* author.start(authorRequest(repo.dir, pin, model));
      }).pipe(Effect.scoped, Effect.provide(harness.layer));

      expect(searchContext).toContain("models/planning_slot.py");
      expect(searchContext).toContain("models/planning_pool_item.py");
      expect(searchContext).not.toContain("LEAKED_OUTSIDE");
      expect(searchContext).not.toContain("leak_link.py");
      expect(process.env.RIPGREP_CONFIG_PATH).toBe(join(harness.snapshotCacheRoot, "ripgrep.conf"));
    }),
  );

  it.effect("loads applicable repository instructions from the pin before the first turn", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      const harness = yield* Effect.promise(() => piHarness());
      repo.write("AGENTS.md", "PINNED ROOT INSTRUCTIONS\n");
      repo.write("models/CLAUDE.md", "PINNED MODEL INSTRUCTIONS\n");
      repo.write("security/AGENTS.md", "UNRELATED SECURITY INSTRUCTIONS\n");
      repo.commit("docs: add repository instructions");
      repo.write(
        "models/planning_pool_item.py",
        `${readFileSync(join(repo.dir, "models/planning_pool_item.py"), "utf8")}\n# context fixture\n`,
      );
      const contextPin = repo.commit("feat: update the pool model");
      repo.write("AGENTS.md", "WORKING TREE INSTRUCTIONS\n");
      repo.write("models/CLAUDE.md", "WORKING TREE MODEL INSTRUCTIONS\n");
      let systemPrompt = "";
      const progress: AuthorProgress[] = [];
      harness.faux.setResponses([
        (context) => {
          systemPrompt = context.systemPrompt ?? "";
          return submitted(validBody);
        },
      ]);

      yield* Effect.gen(function* () {
        const author = yield* WalkthroughAuthor;
        const model = yield* fauxModel();
        yield* author.start(
          authorRequest(repo.dir, contextPin, model, (event) => progress.push(event)),
        );
      }).pipe(Effect.scoped, Effect.provide(harness.layer));

      expect(systemPrompt).toContain("PINNED ROOT INSTRUCTIONS");
      expect(systemPrompt).toContain("PINNED MODEL INSTRUCTIONS");
      expect(systemPrompt).not.toContain("WORKING TREE INSTRUCTIONS");
      expect(systemPrompt).not.toContain("WORKING TREE MODEL INSTRUCTIONS");
      expect(systemPrompt).not.toContain("UNRELATED SECURITY INSTRUCTIONS");
      expect(progress.some((event) => event._tag === "AuthorNotice")).toBe(false);
    }),
  );

  it.effect("reads and updates Pi's global model preference", () =>
    Effect.gen(function* () {
      const harness = yield* Effect.promise(() => piHarness());
      const stored = yield* Effect.gen(function* () {
        const author = yield* WalkthroughAuthor;
        expect(Option.isNone(yield* author.modelPreference)).toBe(true);
        const model = yield* fauxModel();
        yield* author.rememberModel(model);
        return yield* author.modelPreference;
      }).pipe(Effect.provide(harness.layer));

      expect(Option.getOrUndefined(stored)).toEqual({
        providerId: "faux",
        modelId: "faux-1",
      });
      expect(harness.settingsManager.getDefaultProvider()).toBe("faux");
      expect(harness.settingsManager.getDefaultModel()).toBe("faux-1");
    }),
  );

  it.effect("keeps Pi preference I/O failures typed", () =>
    Effect.gen(function* () {
      const brokenSettings = coding.SettingsManager.fromStorage({
        withLock: () => {
          throw new Error("settings unavailable");
        },
      });
      const harness = yield* Effect.promise(() => piHarness(true, brokenSettings));
      const failures = yield* Effect.gen(function* () {
        const author = yield* WalkthroughAuthor;
        const read = yield* Effect.flip(author.modelPreference);
        const model = yield* fauxModel();
        const write = yield* Effect.flip(author.rememberModel(model));
        return { read, write };
      }).pipe(Effect.provide(harness.layer));

      expect(failures.read._tag).toBe("AuthorPreferenceReadFailed");
      expect(failures.write._tag).toBe("AuthorPreferenceWriteFailed");
    }),
  );

  it.effect("stops serving diffs after the bounded inspection budget", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      const harness = yield* Effect.promise(() => piHarness());
      let finalRequest = "";
      const progress: AuthorProgress[] = [];
      /* One changed file floors the medium budget at 16 diff reads. */
      harness.faux.setResponses([
        ...Array.from({ length: 17 }, () =>
          ai.fauxAssistantMessage(ai.fauxToolCall("read_pr_diff", { path: CHANGED_FILE.path }), {
            stopReason: "toolUse",
          }),
        ),
        (context) => {
          finalRequest = JSON.stringify(context.messages);
          return submitted(validBody);
        },
      ]);

      yield* Effect.gen(function* () {
        const author = yield* WalkthroughAuthor;
        const model = yield* fauxModel();
        yield* author.start(
          authorRequest(repo.dir, repo.pin, model, (event) => progress.push(event)),
        );
      }).pipe(Effect.scoped, Effect.provide(harness.layer));

      expect(finalRequest).toContain("Diff inspection budget reached after 16 reads");
      expect(progress.some((event) => event._tag === "AuthorAssistantText")).toBe(false);
      expect(progress.some((event) => event._tag === "AuthorToolFinished")).toBe(false);
      expect(
        progress
          .filter((event) => event._tag === "AuthorToolStarted")
          .every((event) => event.input === ""),
      ).toBe(true);
    }),
  );

  it.effect("accepts a draft with many code ranges — the walkthrough has no range cap", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      const harness = yield* Effect.promise(() => piHarness());
      const manyRanges = Array.from(
        { length: 11 },
        (_, index) =>
          `{% code file="models/planning_pool_item.py" from=1 to=1 expect="${PINNED_LINE}" /%}\n${index}`,
      ).join("\n");
      harness.faux.setResponses([submitted(manyRanges)]);

      const turn = yield* Effect.gen(function* () {
        const author = yield* WalkthroughAuthor;
        const model = yield* fauxModel();
        const session = yield* author.start(authorRequest(repo.dir, repo.pin, model));
        return session.initial;
      }).pipe(Effect.scoped, Effect.provide(harness.layer));

      expect(turn.draft.body).toBe(manyRanges);
    }),
  );

  it.effect("exposes missing authentication without reading the user's Pi store", () =>
    Effect.gen(function* () {
      const harness = yield* Effect.promise(() => piHarness(false));
      const { methods, models } = yield* Effect.gen(function* () {
        const author = yield* WalkthroughAuthor;
        return {
          models: yield* author.availableModels,
          methods: yield* author.loginMethods,
        };
      }).pipe(Effect.provide(harness.layer));

      expect(models).toEqual([]);
      expect(methods).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ providerId: "anthropic", method: "oauth" }),
          expect.objectContaining({ providerId: "anthropic", method: "api_key" }),
          expect.objectContaining({ providerId: "openai-codex", method: "oauth" }),
          expect.objectContaining({ providerId: "openai", method: "api_key" }),
        ]),
      );
    }),
  );

  it.effect("keeps an unavailable model as a typed startup failure", () =>
    Effect.gen(function* () {
      const harness = yield* Effect.promise(() => piHarness(false));
      const unavailable = yield* Schema.decodeUnknownEffect(AuthorModelSchema)({
        providerId: "missing-provider",
        providerName: "Missing provider",
        modelId: "missing-model",
        modelName: "Missing model",
      });

      const error = yield* Effect.gen(function* () {
        const author = yield* WalkthroughAuthor;
        return yield* Effect.flip(author.start(authorRequest(".", "invalid", unavailable)));
      }).pipe(Effect.scoped, Effect.provide(harness.layer));

      expect(error).toMatchObject({
        _tag: "AuthorModelUnavailable",
        provider: "missing-provider",
        model: "missing-model",
      });
    }),
  );

  it.effect("keeps snapshot preparation failures in the typed Effect channel", () =>
    Effect.gen(function* () {
      const harness = yield* Effect.promise(() => piHarness());
      const repo = yield* fixture;
      rmSync(harness.snapshotCacheRoot, { recursive: true, force: true });
      writeFileSync(harness.snapshotCacheRoot, "not a directory");

      const error = yield* Effect.gen(function* () {
        const author = yield* WalkthroughAuthor;
        const model = yield* fauxModel();
        return yield* Effect.flip(author.start(authorRequest(repo.dir, repo.pin, model)));
      }).pipe(Effect.scoped, Effect.provide(harness.layer));

      expect(error).toMatchObject({
        _tag: "SnapshotOpenFailed",
        repositoryRoot: repo.dir,
        pin: repo.pin,
      });
    }),
  );

  it.effect("keeps API-key login redacted and translates terminal cancellation", () =>
    Effect.gen(function* () {
      const harness = yield* Effect.promise(() => piHarness());
      harness.modelRuntime.registerNativeProvider({
        ...harness.faux.provider,
        id: "login-test",
        name: "Login Test",
        auth: {
          apiKey: {
            name: "Test API key",
            login: async (interaction) => ({
              type: "api_key" as const,
              key: await interaction.prompt({ type: "secret", message: "API key" }),
            }),
            check: async ({ credential }) =>
              credential?.key === undefined ? undefined : { type: "api_key" as const },
            resolve: async ({ credential }) =>
              credential?.key === undefined
                ? undefined
                : { auth: { apiKey: credential.key }, source: "stored" },
          },
        },
      });

      const result = yield* Effect.gen(function* () {
        const author = yield* WalkthroughAuthor;
        const method = (yield* author.loginMethods).find(
          (candidate) => candidate.providerId === "login-test",
        );
        if (method === undefined) return yield* Effect.die("Login method was not available");
        yield* author.login(method, {
          prompt: async () => {
            throw new Error("Secret prompt crossed the redaction boundary");
          },
          secret: async () => Redacted.make("never-print-this-key"),
          notify: () => {},
        });
        const stored = yield* Effect.promise(() => harness.credentials.list());
        const cancelled = yield* Effect.flip(
          author.login(method, {
            prompt: async () => {
              throw new Error("Secret prompt crossed the redaction boundary");
            },
            secret: async () => Promise.reject(new Terminal.QuitError()),
            notify: () => {},
          }),
        );
        return { cancelled, stored };
      }).pipe(Effect.provide(harness.layer));

      expect(result.stored).toContainEqual({ providerId: "login-test", type: "api_key" });
      expect(result.cancelled._tag).toBe("LoginCancelled");
      expect(JSON.stringify(result)).not.toContain("never-print-this-key");
    }),
  );

  it.effect("translates a terminal provider error", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      const harness = yield* Effect.promise(() => piHarness());
      harness.faux.setResponses([
        ai.fauxAssistantMessage("", {
          stopReason: "error",
          errorMessage: "provider exploded",
        }),
      ]);
      const progress: AuthorProgress[] = [];
      const error = yield* Effect.gen(function* () {
        const author = yield* WalkthroughAuthor;
        const model = yield* fauxModel();
        return yield* Effect.flip(
          author.start(authorRequest(repo.dir, repo.pin, model, (event) => progress.push(event))),
        );
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
      expect(error).toMatchObject({
        _tag: "ProviderRequestFailed",
        detail: "provider exploded",
      });
      expect(progress.filter((event) => event._tag === "AuthorUsageUpdated")).toHaveLength(1);
    }),
  );

  it.effect("rejects an assistant response that never submits the draft", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      const harness = yield* Effect.promise(() => piHarness());
      harness.faux.setResponses([ai.fauxAssistantMessage("Here is some unstructured prose.")]);
      const error = yield* Effect.gen(function* () {
        const author = yield* WalkthroughAuthor;
        const model = yield* fauxModel();
        return yield* Effect.flip(author.start(authorRequest(repo.dir, repo.pin, model)));
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
      expect(error._tag).toBe("DraftMalformed");
    }),
  );

  it.live("bounds Pi cleanup when an in-flight model turn is interrupted", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      const harness = yield* Effect.promise(() => piHarness());
      harness.faux.setResponses([() => new Promise(() => {})]);
      const elapsed = yield* Effect.gen(function* () {
        const author = yield* WalkthroughAuthor;
        const model = yield* fauxModel();
        const fiber = yield* Effect.forkChild(
          author.start(authorRequest(repo.dir, repo.pin, model)).pipe(Effect.scoped),
        );
        while (harness.faux.state.callCount === 0) yield* Effect.sleep("10 millis");
        const started = Date.now();
        yield* Fiber.interrupt(fiber);
        return Date.now() - started;
      }).pipe(Effect.provide(harness.layer));

      expect(elapsed).toBeLessThan(2_000);
    }).pipe(Effect.scoped),
  );
});

describe("generation", () => {
  it.effect("checks a merged pull request against the prepared generation range", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      const harness = yield* Effect.promise(() => piHarness());
      const base = execFileSync("git", ["rev-parse", `${repo.pin}^`], {
        cwd: repo.dir,
        encoding: "utf8",
      }).trim();
      execFileSync("git", ["checkout", "main"], { cwd: repo.dir });
      execFileSync("git", ["merge", "--ff-only", "feature/pool"], { cwd: repo.dir });
      repo.write(CHANGED_FILE.path, "# rewritten after the pull request merged\n");
      repo.commit("refactor: continue on main after the merge");
      const preparedSource = prepared(repo.dir, repo.pin);
      const source: PullSnapshot = {
        ...preparedSource,
        base,
        pull: { ...preparedSource.pull, state: "merged" },
      };
      /* Let the pre-fix repair loop complete so the test observes its false diagnostics. */
      harness.faux.setResponses([submitted(validBody), submitted(validBody), submitted(validBody)]);

      const result = yield* Effect.gen(function* () {
        const model = yield* fauxModel();
        return yield* runGeneration({
          source,
          model,
          directory: "walkthroughs",
          supersede: [],
          headInstructionPolicy: "omit-changed",
          progressMode: "compact",
          progress: () => {},
        });
      }).pipe(Effect.provide(harness.layer));

      expect(result._tag).toBe("Generated");
      expect(result.repairs).toBe(0);
      const codes = result.report.diagnostics.map((diagnostic) => diagnostic.code);
      expect(codes).not.toContain("stale-overlap");
      expect(codes).not.toContain("files-empty");
    }),
  );

  it.effect("writes stamped frontmatter and repairs a draft through check", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      const harness = yield* Effect.promise(() => piHarness());
      repo.write("AGENTS.md", "TRUSTED THROUGH RUN GENERATION\n");
      const pin = repo.commit("docs: change instructions for generation");
      const preparedSource = prepared(repo.dir, pin);
      const source: PullSnapshot = {
        ...preparedSource,
        files: [
          ...preparedSource.files,
          { path: "AGENTS.md", status: "A", additions: 1, deletions: 0, binary: false },
        ],
      };
      let initialContext = "";
      let repairContext = "";
      let systemPrompt = "";
      harness.faux.setResponses([
        (context) => {
          initialContext = JSON.stringify(context.messages);
          systemPrompt = context.systemPrompt ?? "";
          return submitted(invalidBody);
        },
        (context) => {
          repairContext = JSON.stringify(context.messages);
          return submitted(validBody);
        },
      ]);
      const usageTurns: number[] = [];
      const result = yield* Effect.gen(function* () {
        const model = yield* fauxModel();
        return yield* runGeneration({
          source,
          model,
          directory: "walkthroughs",
          supersede: [],
          headInstructionPolicy: "trust-changed",
          progressMode: "compact",
          progress: (event) => {
            if (event._tag === "AuthorUsageUpdated") usageTurns.push(event.usage.total);
          },
        });
      }).pipe(Effect.provide(harness.layer));

      expect(result._tag).toBe("Generated");
      expect(result.repairs).toBe(1);
      expect(usageTurns).toHaveLength(2);
      expect(usageTurns[1]).toBeGreaterThan(usageTurns[0] ?? 0);
      expect(initialContext).toContain("feat: live planning pool items");
      expect(systemPrompt).toContain("TRUSTED THROUGH RUN GENERATION");
      expect(initialContext).not.toContain('\\"pullRequest\\"');
      expect(repairContext).toContain("range-");
      expect(readFileSync(result.file, "utf8")).toBe(
        renderDraft(source, {
          title: "Live planning pool",
          meta: { lang: "en", module: "acme_planning" },
          body: validBody,
        }),
      );
      expect(readFileSync(result.file, "utf8")).toContain(`commit: ${pin}`);
      expect(
        execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo.dir, encoding: "utf8" }).trim(),
      ).toBe(pin);
      expect(
        execFileSync("git", ["diff", "--cached", "--name-only"], {
          cwd: repo.dir,
          encoding: "utf8",
        }),
      ).toBe("");
    }),
  );

  it.effect("stops when a repair leaves the diagnostic codes and lines unchanged", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      const harness = yield* Effect.promise(() => piHarness());
      harness.faux.setResponses([
        submitted(invalidBody, "Needs manual repair"),
        submitted(invalidBody, "Needs manual repair"),
      ]);
      const result = yield* Effect.gen(function* () {
        const model = yield* fauxModel();
        return yield* runGeneration({
          source: prepared(repo.dir, repo.pin),
          model,
          directory: "drafts",
          supersede: [],
          headInstructionPolicy: "omit-changed",
          progressMode: "compact",
          progress: () => {},
        });
      }).pipe(Effect.provide(harness.layer));

      expect(result._tag).toBe("GeneratedWithDiagnostics");
      expect(result.repairs).toBe(1);
      expect(harness.faux.state.callCount).toBe(2);
      expect(existsSync(result.file)).toBe(true);
      expect(result.report.diagnostics.some((diagnostic) => diagnostic.level === "error")).toBe(
        true,
      );
    }),
  );

  it.effect("rejects output through symlinks and inside Git metadata", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      const outside = yield* Effect.acquireRelease(
        Effect.sync(() => mkdtempSync(join(tmpdir(), "balade-output-"))),
        (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
      );
      symlinkSync(outside, join(repo.dir, "linked"));
      const harness = yield* Effect.promise(() => piHarness());
      const errors = yield* Effect.gen(function* () {
        const model = yield* fauxModel();
        const linked = yield* Effect.flip(
          runGeneration({
            source: prepared(repo.dir, repo.pin),
            model,
            directory: "linked/walkthroughs",
            supersede: [],
            headInstructionPolicy: "omit-changed",
            progressMode: "compact",
            progress: () => {},
          }),
        );
        const metadata = yield* Effect.flip(
          runGeneration({
            source: prepared(repo.dir, repo.pin),
            model,
            directory: ".git/walkthroughs",
            supersede: [],
            headInstructionPolicy: "omit-changed",
            progressMode: "compact",
            progress: () => {},
          }),
        );
        return { linked, metadata };
      }).pipe(Effect.provide(harness.layer));

      expect(errors.linked._tag).toBe("OutputOutsideRepository");
      expect(errors.metadata._tag).toBe("OutputOutsideRepository");
      expect(existsSync(join(outside, "walkthroughs"))).toBe(false);
    }),
  );

  it.effect("supersedes the resolved files after the paid turn and still checks the draft", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      const harness = yield* Effect.promise(() => piHarness());
      /* The model's title re-lands on the first file's slug; the second is a re-rolled slug. */
      const target = "walkthroughs/pr-42-live-planning-pool.md";
      const stale = "walkthroughs/pr-42-earlier-title.md";
      repo.write(stale, "committed stale walkthrough\n");
      repo.commit("docs: stale walkthrough");
      repo.write(target, "hand-edited, uncommitted\n");
      const supersede: ExistingWalkthrough[] = [
        {
          file: join(repo.dir, target),
          relativeFile: target,
          stamp: { _tag: "Unstamped" },
        },
        {
          file: join(repo.dir, stale),
          relativeFile: stale,
          stamp: { _tag: "Stamped", pin: "older-head", lang: "en" },
        },
      ];
      harness.faux.setResponses([submitted(validBody)]);

      const result = yield* Effect.gen(function* () {
        const model = yield* fauxModel();
        return yield* runGeneration({
          source: prepared(repo.dir, repo.pin),
          model,
          directory: "walkthroughs",
          supersede,
          headInstructionPolicy: "omit-changed",
          progressMode: "compact",
          progress: () => {},
        });
      }).pipe(Effect.provide(harness.layer));

      /* The write no longer fails on a collision, so the check loop always runs. */
      expect(result._tag).toBe("Generated");
      expect(basename(result.file)).toBe("pr-42-live-planning-pool.md");
      expect(readFileSync(result.file, "utf8")).toContain("title: Live planning pool");
      expect(existsSync(join(repo.dir, stale))).toBe(false);
      expect(readFileSync(join(repo.dir, `${target}.superseded`), "utf8")).toBe(
        "hand-edited, uncommitted\n",
      );
      expect(existsSync(join(repo.dir, `${stale}.superseded`))).toBe(false);
      expect(result.superseded).toEqual([
        { file: target, retainedAt: `${target}.superseded` },
        { file: stale },
      ]);
      expect(result.siblings).toEqual([]);
    }),
  );

  it.effect("retains the invalid file and diagnostics when a repair turn fails", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      const harness = yield* Effect.promise(() => piHarness());
      harness.faux.setResponses([
        submitted(invalidBody, "Repair interrupted"),
        ai.fauxAssistantMessage("", {
          stopReason: "error",
          errorMessage: "repair provider stopped",
        }),
      ]);
      const usage: number[] = [];
      const error = yield* Effect.gen(function* () {
        const model = yield* fauxModel();
        return yield* Effect.flip(
          runGeneration({
            source: prepared(repo.dir, repo.pin),
            model,
            directory: "drafts",
            supersede: [],
            headInstructionPolicy: "omit-changed",
            progressMode: "compact",
            progress: (event) => {
              if (event._tag === "AuthorUsageUpdated") usage.push(event.usage.total);
            },
          }),
        );
      }).pipe(Effect.provide(harness.layer));

      expect(error._tag).toBe("RepairFailed");
      if (error._tag !== "RepairFailed") return;
      expect(existsSync(error.file)).toBe(true);
      expect(error.report.ok).toBe(false);
      expect(error.report.diagnostics).not.toEqual([]);
      expect(usage).toHaveLength(2);
    }),
  );

  it("derives stable, filesystem-safe draft names", () => {
    expect(slugifyTitle("  Déjà vu: API / v2!  ")).toBe("deja-vu-api-v2");
    expect(slugifyTitle("🎉")).toBe("walkthrough");
    expect(
      matchingModels(
        [
          Schema.decodeUnknownSync(AuthorModelSchema)({
            providerId: "faux",
            providerName: "Faux",
            modelId: "one",
            modelName: "One",
          }),
        ],
        { providerId: "other" },
      ),
    ).toEqual([]);
    const models = [
      Schema.decodeUnknownSync(AuthorModelSchema)({
        providerId: "faux",
        providerName: "Faux",
        modelId: "one",
        modelName: "One",
      }),
    ];
    const first = models[0];
    if (first === undefined) throw new Error("test model fixture is empty");
    const preference = Option.some({
      providerId: first.providerId,
      modelId: first.modelId,
    });
    expect(Option.getOrUndefined(preferredModel(models, preference))).toEqual(first);
    expect(modelSelectionFromFlags(Option.none(), Option.none())).toEqual({
      _tag: "UsePreference",
    });
    expect(modelSelectionFromFlags(Option.some("  faux  "), Option.some(""))).toEqual({
      _tag: "Choose",
      filter: { providerId: "faux" },
    });
    expect(modelSelectionFromFlags(Option.some(""), Option.none())).toEqual({
      _tag: "Choose",
      filter: {},
    });

    const second = Schema.decodeUnknownSync(AuthorModelSchema)({
      providerId: "other",
      providerName: "Other",
      modelId: "two",
      modelName: "Two",
    });
    expect(
      modelsForPicker([...models, second], { providerId: "faux", modelId: "missing" }),
    ).toEqual({
      models,
      usedFallback: true,
    });
    expect(modelsForPicker([...models, second], { providerId: "missing", modelId: "two" })).toEqual(
      {
        models: [second],
        usedFallback: true,
      },
    );
    expect(
      modelsForPicker([...models, second], { providerId: "missing", modelId: "absent" }),
    ).toEqual({
      models: [...models, second],
      usedFallback: true,
    });
  });
});
