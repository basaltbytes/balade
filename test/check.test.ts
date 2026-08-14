import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest";
import { runBuild } from "../src/commands/build/pipeline.js";
import { formatJson, formatText } from "../src/terminal.js";
import { checkOne, outcomeFromReports, runCheck } from "../src/walkthrough/checker.js";
import { loadWalkthrough } from "../src/walkthrough/pipeline.js";
import type { CheckDiagnostic, CheckReport } from "../src/contract/types.js";
import { prepareSession } from "../src/server/session.js";
import { contextResolverLive } from "../src/git/git.js";
import { unavailableGhLayer } from "./support/command.js";
import { provideLive } from "./support/effect.js";
import { createFixtureRepo, type FixtureRepo } from "./support/repo.js";

function codes(diagnostics: readonly CheckDiagnostic[]): string[] {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

function find(report: CheckReport, code: string): CheckDiagnostic {
  const diagnostic = report.diagnostics.find((entry) => entry.code === code);
  if (diagnostic === undefined)
    throw new Error(`no ${code} in ${codes(report.diagnostics).join(", ")}`);
  return diagnostic;
}

const resolverWithoutGh = Layer.mergeAll(
  NodeServices.layer,
  unavailableGhLayer,
  contextResolverLive.pipe(Layer.provide(unavailableGhLayer)),
);

describe("check", () => {
  let repo: FixtureRepo;
  let valid: CheckReport;
  let errors: CheckReport;

  beforeAll(async () => {
    repo = createFixtureRepo();
    repo.addWalkthrough("valid.md", "valid.md");
    repo.addWalkthrough("errors.md", "errors.md");
    repo.addWalkthrough("duplicate.md", "duplicate.md");
    /* `generate` writes here by default; discovery must still see it. */
    repo.addWalkthrough("dotted.md", "valid.md", ".agents/walkthroughs");
    valid = await Effect.runPromise(
      provideLive(
        checkOne({
          cwd: repo.dir,
          path: join(repo.dir, "walkthroughs/valid.md"),
          useGh: false,
        }),
      ),
    );
    errors = await Effect.runPromise(
      provideLive(
        checkOne({
          cwd: repo.dir,
          path: join(repo.dir, "walkthroughs/errors.md"),
          useGh: false,
        }),
      ),
    );
  });

  afterAll(() => repo.cleanup());

  it("passes a valid walkthrough with warnings only", () => {
    expect(valid.ok).toBe(true);
    expect(valid.diagnostics.every((diagnostic) => diagnostic.level === "warning")).toBe(true);
    /* The walkthrough commit itself moved the head past the stamp. */
    expect(codes(valid.diagnostics)).toContain("stale");
    expect(find(valid, "stale").level).toBe("warning");
  });

  it("reports every planted error in one pass", () => {
    expect(errors.ok).toBe(false);
    expect(codes(errors.diagnostics)).toEqual(
      expect.arrayContaining([
        "frontmatter-key-unknown",
        "tag-undefined",
        "section-id-duplicate",
        "range-unresolvable",
        "file-unresolvable",
        "expect-mismatch",
        "expect-missing",
        "preset-tag-inactive",
      ]),
    );
  });

  it("gives every diagnostic a code, a place and a fix hint", () => {
    for (const diagnostic of errors.diagnostics) {
      expect(diagnostic.code).toBeTruthy();
      expect(diagnostic.file).toBe("walkthroughs/errors.md");
      expect(diagnostic.line).toBeGreaterThan(0);
      expect(diagnostic.hint).toBeTruthy();
      expect(diagnostic.message).toBeTruthy();
    }
  });

  it("fails a wrong expect= and prints both sides", () => {
    const mismatch = find(errors, "expect-mismatch");
    expect(mismatch.level).toBe("error");
    expect(mismatch.expected).toBe("class PlanningPoolItem");
    expect(mismatch.actual).toBe("from odoo import api, fields, models");
  });

  it("warns on a missing expect= without failing on it", () => {
    expect(find(errors, "expect-missing").level).toBe("warning");
    const onlyMissing = errors.diagnostics.filter(
      (d) => d.code === "expect-missing" && d.level === "error",
    );
    expect(onlyMissing).toEqual([]);
  });

  it("names the inactive preset and how to activate it", () => {
    const inactive = find(errors, "preset-tag-inactive");
    expect(inactive.message).toContain("o-field");
    expect(inactive.hint).toContain("preset: odoo");
  });

  it("echoes the boundary lines of every resolved range", () => {
    expect(valid.ranges).toEqual([
      {
        file: "models/planning_pool_item.py",
        from: 1,
        to: 16,
        firstLine: "from odoo import api, fields, models",
        lastLine: "            item.placed = 0.0",
        atLine: expect.any(Number),
      },
    ]);
    /* Unresolvable ranges echo nothing; the two resolvable ones do. */
    expect(errors.ranges.map((range) => `${range.from}-${range.to}`)).toEqual(["1-3", "4-6"]);
    expect(errors.ranges[1]).toMatchObject({
      firstLine: "class PlanningPoolItem(models.Model):",
      lastLine: '    _description = "Pool item"',
    });
  });

  it.effect("still builds a payload for soft `open`, with error cards", () =>
    Effect.gen(function* () {
      const loaded = yield* provideLive(
        loadWalkthrough({
          cwd: repo.dir,
          path: join(repo.dir, "walkthroughs/errors.md"),
          useGh: false,
        }),
      );
      const payload = loaded.payload;
      expect(payload).not.toBeNull();
      expect(payload?.errors.map((card) => card.code)).toEqual([
        "range-unresolvable",
        "file-unresolvable",
      ]);
      expect(payload?.errors[1]).toMatchObject({
        reference: "models/does_not_exist.py:1-3",
        sectionId: "one",
      });
      /* The duplicate section stays out of the payload; the unique ones stay in. */
      expect(payload?.sections.map((section) => section.id)).toEqual(["one", "three"]);
      /* A mismatched expect= still renders — the block carries the warning. */
      const blocks = payload?.sections.find((section) => section.id === "three")?.blocks ?? [];
      const code = blocks.filter((entry) => entry.b === "code");
      expect(code).toHaveLength(2);
      expect(code[0]?.expect).toEqual({ value: "class PlanningPoolItem", status: "mismatch" });
      expect(code[1]?.expect).toBeUndefined();
    }),
  );

  it.effect("keeps validation strict while build and open preserve error cards", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const bundleDir = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const dir = mkdtempSync(join(tmpdir(), "balade-core-pipelines-"));
            writeFileSync(join(dir, "app.js"), "window.__BALADE_TEST__ = true;\n", "utf8");
            writeFileSync(join(dir, "app.css"), "#root{}\n", "utf8");
            return dir;
          }),
          (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
        );
        const path = join(repo.dir, "walkthroughs/errors.md");

        const checked = yield* provideLive(
          runCheck({ cwd: repo.dir, paths: [path], useGh: false }),
        );
        expect(checked._tag).toBe("CheckFailed");

        const built = yield* provideLive(
          runBuild({ cwd: repo.dir, paths: [path], useGh: false, bundleDir }),
        );
        if (built._tag !== "Built") throw new Error(`build refused: ${built._tag}`);
        expect(built.reports[0]?.diagnostics).toContainEqual(
          expect.objectContaining({ code: "range-unresolvable", level: "error" }),
        );

        const prepared = yield* provideLive(
          prepareSession({
            cwd: repo.dir,
            selection: { kind: "files", paths: [path] },
            useGh: false,
          }),
        );
        if (prepared._tag !== "SessionReady") {
          throw new Error(`open refused to start: ${prepared._tag}`);
        }
        expect(prepared.session.reports[0]?.diagnostics).toContainEqual(
          expect.objectContaining({ code: "range-unresolvable", level: "error" }),
        );
        const payload = yield* prepared.session.api.walkthrough(null);
        if ("kind" in payload) throw new Error("single walkthrough returned an index");
        expect(payload.errors.map((card) => card.code)).toEqual([
          "range-unresolvable",
          "file-unresolvable",
        ]);
      }),
    ),
  );

  it.effect("keeps optional gh failure as a warning in the successful load result", () =>
    Effect.gen(function* () {
      const loaded = yield* loadWalkthrough({
        cwd: repo.dir,
        path: join(repo.dir, "walkthroughs/valid.md"),
      });
      expect(loaded.payload).not.toBeNull();
      expect(loaded.diagnostics).toContainEqual(
        expect.objectContaining({ code: "gh-unavailable", level: "warning" }),
      );
    }).pipe(Effect.provide(resolverWithoutGh)),
  );

  it.effect("translates a real load failure only at the check boundary", () =>
    Effect.gen(function* () {
      const missing = join(repo.dir, "walkthroughs/missing.md");
      const failure = yield* provideLive(
        loadWalkthrough({ cwd: repo.dir, path: missing, useGh: false }).pipe(Effect.flip),
      );
      expect(failure).toMatchObject({
        _tag: "WalkthroughFileReadFailed",
        path: "walkthroughs/missing.md",
      });

      const report = yield* provideLive(checkOne({ cwd: repo.dir, path: missing, useGh: false }));
      expect(report).toMatchObject({
        ok: false,
        diagnostics: [expect.objectContaining({ code: "file-unresolvable", level: "error" })],
      });
    }),
  );

  it.effect("reports a duplicate section without orphaning its error cards", () =>
    Effect.gen(function* () {
      const path = join(repo.dir, "walkthroughs/duplicate.md");
      const loaded = yield* provideLive(loadWalkthrough({ cwd: repo.dir, path, useGh: false }));
      expect(loaded.diagnostics.some((diagnostic) => diagnostic.level === "error")).toBe(true);
      /* The duplicate's failing `code` tag is reported… */
      expect(codes(loaded.diagnostics)).toEqual(
        expect.arrayContaining(["section-id-duplicate", "file-unresolvable"]),
      );

      /* …but no card survives it: every card names a section the payload renders. */
      expect(loaded.payload?.sections.map((section) => section.id)).toEqual(["dup"]);
      expect(loaded.payload?.errors).toEqual([]);
    }),
  );

  it.effect("checks every related id against the document's sections", () =>
    Effect.gen(function* () {
      repo.write(
        "walkthroughs/related.md",
        `---
walkthrough: 1
title: Related sections
pr: 42
commit: ${repo.pin}
---

{% group label="Models" %}
{% section id="model" title="Model" related=["proof", "missing-section"] %}
Prose.
{% /section %}
{% section id="proof" title="Proof" %}
Evidence.

{% files /%}
{% /section %}
{% /group %}
`,
      );
      const report = yield* provideLive(
        checkOne({ cwd: repo.dir, path: join(repo.dir, "walkthroughs/related.md"), useGh: false }),
      );
      /* The forward reference to `proof` resolves; only the unknown id reports. */
      const unknown = report.diagnostics.filter((d) => d.code === "related-section-unknown");
      expect(unknown).toHaveLength(1);
      expect(unknown[0]?.message).toContain("missing-section");
      expect(report.ok).toBe(false);
    }),
  );

  it.effect("requires the last section to expose the unfiltered PR diff", () =>
    Effect.gen(function* () {
      const path = join(repo.dir, "walkthroughs/filtered-files-close.md");
      repo.write(
        "walkthroughs/filtered-files-close.md",
        `---
walkthrough: 1
title: Closing files
pr: 42
commit: ${repo.pin}
---

{% section id="overview" title="Overview" %}
{% files /%}
{% /section %}
{% section id="files" title="Full PR diff" %}
{% files only="src/**" /%}
{% /section %}
`,
      );
      const rejected = yield* provideLive(checkOne({ cwd: repo.dir, path, useGh: false }));

      expect(find(rejected, "closing-files-missing")).toMatchObject({
        level: "error",
        message: expect.stringContaining("last section"),
        hint: expect.stringContaining("unfiltered"),
      });
      expect(codes(valid.diagnostics)).not.toContain("closing-files-missing");
      expect(valid.ok).toBe(true);
    }),
  );

  it.effect("discovers every tracked walkthrough with no argument", () =>
    Effect.gen(function* () {
      const outcome = yield* provideLive(runCheck({ cwd: repo.dir, useGh: false }));
      expect(outcome.reports.map((report) => report.file)).toEqual([
        ".agents/walkthroughs/dotted.md",
        "walkthroughs/duplicate.md",
        "walkthroughs/errors.md",
        "walkthroughs/valid.md",
      ]);
      expect(outcome._tag).toBe("CheckFailed");
    }),
  );

  it("prints the same facts as text and as JSON", () => {
    const outcome = outcomeFromReports([errors]);
    const text = formatText(outcome);
    expect(text).toContain("walkthroughs/errors.md");
    expect(text).toContain("expect-mismatch");
    expect(text).toContain("expected  class PlanningPoolItem");
    expect(text).toContain("code ranges (2)");
    /* SAFETY: `formatJson` serialized this exact report envelope one line above. */
    const parsed = JSON.parse(formatJson(outcome)) as { ok: boolean; reports: CheckReport[] };
    expect(parsed).not.toHaveProperty("_tag");
    expect(parsed.ok).toBe(false);
    expect(parsed.reports[0]?.diagnostics.length).toBe(errors.diagnostics.length);
    expect(parsed.reports[0]?.ranges.length).toBe(2);
  });
});

describe("staleness", () => {
  let repo: FixtureRepo;

  beforeAll(() => {
    repo = createFixtureRepo();
    repo.addWalkthrough("valid.md", "valid.md");
  });

  afterAll(() => repo.cleanup());

  it.effect("fails only when a later commit touches a referenced file", () =>
    Effect.gen(function* () {
      const before = yield* provideLive(
        checkOne({
          cwd: repo.dir,
          path: join(repo.dir, "walkthroughs/valid.md"),
          useGh: false,
        }),
      );
      expect(before.ok).toBe(true);

      repo.write("models/planning_pool_item.py", "# rewritten after the stamp\n");
      repo.commit("refactor: rewrite the pool item");

      const after = yield* provideLive(
        checkOne({
          cwd: repo.dir,
          path: join(repo.dir, "walkthroughs/valid.md"),
          useGh: false,
        }),
      );
      expect(after.ok).toBe(false);
      const overlap = after.diagnostics.find((diagnostic) => diagnostic.code === "stale-overlap");
      expect(overlap?.level).toBe("error");
      expect(overlap?.message).toContain("models/planning_pool_item.py");
      expect(overlap?.hint).toContain("re-stamp");
    }),
  );
});

describe("no walkthrough", () => {
  it.effect("says so instead of failing", () =>
    Effect.gen(function* () {
      const outcome = yield* provideLive(runCheck({ cwd: "/", useGh: false }));
      expect(outcome._tag).toBe("CheckPassed");
      expect(outcome.note).toBeTruthy();
    }),
  );
});
