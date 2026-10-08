/**
 * The programmatic entry through Pi's faux author and real fixture clones:
 * no terminal, typed refusals, and the same events the CLI renders.
 */

import * as ai from "@earendil-works/pi-ai";
import { NodeServices } from "@effect/platform-node";
import { execFileSync } from "node:child_process";
import { Effect, Layer } from "effect";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { makeGenerationProgress } from "../src/commands/generate/progress-terminal.js";
import type { GenerationProgress } from "../src/commands/generate/progress.js";
import { contextResolverLive } from "../src/git/git.js";
import {
  buildWalkthrough,
  checkWalkthrough,
  generate,
  generateWalkthrough,
  type GenerateOptions,
} from "../src/library.js";
import { plainTheme } from "../src/terminal.js";
import { unavailableGhLayer } from "./support/command.js";
import { piHarness, releasePiHarnesses } from "./support/pi.js";
import { cloneOnMain, createFixtureRepo, type FixtureRepo } from "./support/repo.js";

afterEach(releasePiHarnesses);

/** gh stays deterministic: the fixture origin is a directory, never a GitHub repository. */
const libraryShell = Layer.mergeAll(NodeServices.layer, unavailableGhLayer);
const resolverLayer = contextResolverLive.pipe(Layer.provideMerge(libraryShell));

const fixture = Effect.acquireRelease(Effect.sync(createFixtureRepo), (repo) =>
  Effect.sync(() => repo.cleanup()),
);

/** A reviewer's clone: `origin/HEAD` names `main`, as a GitHub clone's does, so the diff base is the merge-base. */
const cloneOf = (origin: FixtureRepo, pull: number) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const clone = cloneOnMain(origin, pull);
      execFileSync("git", ["remote", "set-head", "origin", "main"], { cwd: clone.dir });
      execFileSync("git", ["fetch", "--quiet", "origin", "main"], { cwd: clone.dir });
      return clone;
    }),
    (clone) => Effect.sync(() => clone.cleanup()),
  );

const FAUX_MODEL = { providerId: "faux", modelId: "faux-1" };
const PINNED_LINE = "from odoo import api, fields, models";
const WALKTHROUGH = ".agents/walkthroughs/pr-42-live-planning-pool.md";

const validBody = `{% group label="Overview" %}
{% section id="overview" title="Pool model" %}

The pool model computes live placement from slots.

{% code file="models/planning_pool_item.py" from=1 to=8 expect="${PINNED_LINE}" /%}

{% /section %}
{% /group %}

{% group label="Full PR diff" %}
{% section id="files" title="Full PR diff" %}

{% files /%}

{% /section %}
{% /group %}`;

const submitted = () =>
  ai.fauxAssistantMessage(
    ai.fauxToolCall("submit_walkthrough", {
      title: "Live planning pool",
      meta: { lang: "en", module: "acme_planning" },
      body: validBody,
    }),
    { stopReason: "toolUse" },
  );

const stubBundle = Effect.acquireRelease(
  Effect.sync(() => {
    const dir = mkdtempSync(join(tmpdir(), "balade-library-export-"));
    writeFileSync(join(dir, "app.js"), "window.__BALADE_STUB__ = true;\n", "utf8");
    writeFileSync(join(dir, "app.css"), "#root{color:#fff}\n", "utf8");
    return dir;
  }),
  (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
);

describe("the library entry", () => {
  it.effect(
    "generates without a terminal: omits changed instructions by default, refuses a same-head replacement, replaces on force",
    () =>
      Effect.gen(function* () {
        const origin = yield* fixture;
        origin.write("AGENTS.md", "PINNED HEAD INSTRUCTIONS\n");
        const pin = origin.commit("docs: instructions changed by the pull request");
        const clone = yield* cloneOf(origin, 42);
        const harness = yield* Effect.promise(() => piHarness({ shell: libraryShell }));
        const systemPrompts: string[] = [];
        harness.faux.setResponses([
          (context) => {
            systemPrompts.push(ai.getCurrentSystemPrompt(context.messages));
            return submitted();
          },
          (context) => {
            systemPrompts.push(ai.getCurrentSystemPrompt(context.messages));
            return submitted();
          },
        ]);
        const events: GenerationProgress[] = [];
        const options: GenerateOptions = {
          repository: clone.dir,
          pullRequest: "#42",
          model: FAUX_MODEL,
          onProgress: (event) => events.push(event),
        };
        const run = (overrides: Partial<GenerateOptions>) =>
          generateWalkthrough({ ...options, ...overrides }).pipe(Effect.provide(harness.layer));

        /* Default policy: the changed AGENTS.md is skipped and reported; nothing asked. */
        const first = yield* run({});
        expect(first._tag).toBe("Generated");
        /* Absolute under the clone; the root's spelling is git's canonical one, not the fixture's. */
        expect(
          first.file.endsWith(join(".agents", "walkthroughs", "pr-42-live-planning-pool.md")),
        ).toBe(true);
        expect(existsSync(join(clone.dir, WALKTHROUGH))).toBe(true);
        expect(readFileSync(first.file, "utf8")).toContain(`commit: ${pin}`);
        expect(first.repairs).toBe(0);
        expect(first.usage.total).toBeGreaterThan(0);
        expect(first.timing.totalMilliseconds).toBeGreaterThan(0);
        expect(first.notices.map((notice) => notice.code)).toContain("gh-unavailable");
        expect(systemPrompts[0]).not.toContain("PINNED HEAD INSTRUCTIONS");
        expect(
          events.flatMap((event) => (event._tag === "AuthorNotice" ? [event.code] : [])),
        ).toEqual(["head-instructions-skipped"]);
        /* The terminal renderer is one consumer of these events: it renders them as-is. */
        const statuses = events.flatMap((event) =>
          event._tag === "GenerationStatusChanged" ? [event.status] : [],
        );
        expect(statuses[0]).toEqual({ _tag: "PreparingGeneration" });
        expect(statuses.at(-1)).toEqual({ _tag: "CheckingGeneration", pass: 1 });
        expect(statuses).toContainEqual({ _tag: "AuthoringGeneration", turn: 1 });
        const rendered: string[] = [];
        const render = makeGenerationProgress({
          write: (value) => rendered.push(value),
          mode: "compact",
          presentation: "pipe",
          theme: plainTheme,
          onStatus: () => {},
        });
        for (const event of events) render(event);
        expect(rendered).toContain("→ Started authoring the walkthrough (turn 1).\n");
        expect(rendered).toContain(
          "→ Started checking the draft against the pinned source (pass 1).\n",
        );

        /* The same head again: the CLI would ask; the library refuses, naming the file. */
        const blocked = yield* Effect.flip(run({}));
        expect(blocked._tag).toBe("ExistingWalkthroughUndecided");
        if (blocked._tag !== "ExistingWalkthroughUndecided") return;
        expect(blocked.files).toEqual([WALKTHROUGH]);
        expect(blocked.message).toContain("`force: true`");
        expect(systemPrompts).toHaveLength(1);

        /* `force` replaces, keeping the uncommitted copy; trusting instructions is explicit. */
        events.length = 0;
        const replaced = yield* run({ force: true, headInstructions: "trust-changed" });
        expect(replaced._tag).toBe("Generated");
        expect(replaced.superseded).toEqual([
          { file: WALKTHROUGH, retainedAt: `${WALKTHROUGH}.superseded` },
        ]);
        expect(existsSync(join(clone.dir, `${WALKTHROUGH}.superseded`))).toBe(true);
        expect(systemPrompts[1]).toContain("PINNED HEAD INSTRUCTIONS");
        expect(
          events.flatMap((event) => (event._tag === "AuthorNotice" ? [event.code] : [])),
        ).toEqual(["head-instructions-trusted"]);
      }),
  );

  it.effect("resolves the model without a picker, before the pull request is touched", () =>
    Effect.gen(function* () {
      const harness = yield* Effect.promise(() => piHarness({ shell: libraryShell }));
      const nowhere = join(tmpdir(), "balade-library-no-repository");
      const unresolved = yield* Effect.flip(
        generateWalkthrough({
          repository: nowhere,
          pullRequest: 42,
          model: { providerId: "faux", modelId: "missing" },
        }).pipe(Effect.provide(harness.layer)),
      );
      expect(unresolved._tag).toBe("AgentModelUnresolved");
      if (unresolved._tag !== "AgentModelUnresolved") return;
      expect(unresolved.requested).toBe("faux/missing");
      expect(unresolved.available.map((model) => model.modelId)).toContain("faux-1");
      expect(unresolved.message).toContain("Available: faux/faux-1");

      /* No saved preference to fall back on: the same refusal, never a prompt. */
      const unsaved = yield* Effect.flip(
        generateWalkthrough({ repository: nowhere, pullRequest: 42 }).pipe(
          Effect.provide(harness.layer),
        ),
      );
      expect(unsaved._tag).toBe("AgentModelUnresolved");
      if (unsaved._tag !== "AgentModelUnresolved") return;
      expect(unsaved.requested).toBe("the saved model preference");

      const unauthenticated = yield* Effect.promise(() =>
        piHarness({ faux: false, shell: libraryShell }),
      );
      const missing = yield* Effect.flip(
        generateWalkthrough({ repository: nowhere, pullRequest: 42, model: FAUX_MODEL }).pipe(
          Effect.provide(unauthenticated.layer),
        ),
      );
      expect(missing._tag).toBe("NoProviderAuthenticated");
      expect(missing.message).toContain("balade agent setup");
    }),
  );

  it("rejects the promise with the tagged error carrying the CLI's sentence", async () => {
    await expect(generate({ pullRequest: "not-a-pull-request" })).rejects.toMatchObject({
      _tag: "PullTargetInvalid",
      target: "not-a-pull-request",
      message: expect.stringContaining("Name one GitHub pull request"),
    });
    await expect(generate({ pullRequest: 42, preset: "nope" })).rejects.toMatchObject({
      _tag: "PresetUnknown",
      preset: "nope",
      available: expect.arrayContaining(["odoo"]),
    });
  });

  it.effect("checks and builds one file through the command pipelines", () =>
    Effect.gen(function* () {
      const origin = yield* fixture;
      const file = join(origin.dir, origin.addWalkthrough("valid.md", "valid.md"));
      const report = yield* checkWalkthrough(file, { useGh: false });
      expect(report.ok).toBe(true);
      expect(report.file).toBe("walkthroughs/valid.md");
      expect(report.ranges.length).toBeGreaterThan(0);

      const bundleDir = yield* stubBundle;
      const out = join(origin.dir, "review.html");
      const built = yield* buildWalkthrough(file, { out, useGh: false, bundleDir });
      expect(built._tag).toBe("Built");
      if (built._tag !== "Built") return;
      expect(built.file).toBe(out);
      expect(readFileSync(out, "utf8")).toContain("window.__BALADE__=");

      const unreadable = yield* Effect.flip(
        buildWalkthrough(join(origin.dir, "missing.md"), { useGh: false, bundleDir }),
      );
      expect(unreadable._tag).toBe("WalkthroughFileReadFailed");
      expect(unreadable.message).toContain("could not read");
    }).pipe(Effect.provide(resolverLayer)),
  );
});
