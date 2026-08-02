import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatJson, formatText } from "../src/check/report.js";
import { checkOne, runCheck } from "../src/check/run.js";
import { loadWalkthrough } from "../src/compile/load.js";
import type { CheckDiagnostic, CheckReport } from "../src/payload/types.js";
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

describe("check", () => {
  let repo: FixtureRepo;
  let valid: CheckReport;
  let errors: CheckReport;

  beforeAll(() => {
    repo = createFixtureRepo();
    repo.addWalkthrough("valid.md", "valid.md");
    repo.addWalkthrough("errors.md", "errors.md");
    repo.addWalkthrough("duplicate.md", "duplicate.md");
    valid = checkOne({
      cwd: repo.dir,
      path: join(repo.dir, "walkthroughs/valid.md"),
      useGh: false,
    });
    errors = checkOne({
      cwd: repo.dir,
      path: join(repo.dir, "walkthroughs/errors.md"),
      useGh: false,
    });
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

  it("still builds a payload for soft `open`, with error cards", () => {
    const loaded = loadWalkthrough({
      cwd: repo.dir,
      path: join(repo.dir, "walkthroughs/errors.md"),
      useGh: false,
    });
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
  });

  it("reports a duplicate section without orphaning its error cards", () => {
    const path = join(repo.dir, "walkthroughs/duplicate.md");
    const loaded = loadWalkthrough({ cwd: repo.dir, path, useGh: false });
    expect(loaded.diagnostics.some((diagnostic) => diagnostic.level === "error")).toBe(true);
    /* The duplicate's failing `code` tag is reported… */
    expect(codes(loaded.diagnostics)).toEqual(
      expect.arrayContaining(["section-id-duplicate", "file-unresolvable"]),
    );

    /* …but no card survives it: every card names a section the payload renders. */
    expect(loaded.payload?.sections.map((section) => section.id)).toEqual(["dup"]);
    expect(loaded.payload?.errors).toEqual([]);
  });

  it("discovers every tracked walkthrough with no argument", () => {
    const outcome = runCheck({ cwd: repo.dir, useGh: false });
    expect(outcome.reports.map((report) => report.file)).toEqual([
      "walkthroughs/duplicate.md",
      "walkthroughs/errors.md",
      "walkthroughs/valid.md",
    ]);
    expect(outcome.ok).toBe(false);
  });

  it("prints the same facts as text and as JSON", () => {
    const outcome = { ok: false, reports: [errors] };
    const text = formatText(outcome);
    expect(text).toContain("walkthroughs/errors.md");
    expect(text).toContain("expect-mismatch");
    expect(text).toContain("expected  class PlanningPoolItem");
    expect(text).toContain("code ranges (2)");
    const parsed = JSON.parse(formatJson(outcome)) as { ok: boolean; reports: CheckReport[] };
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

  it("fails only when a later commit touches a referenced file", () => {
    const before = checkOne({
      cwd: repo.dir,
      path: join(repo.dir, "walkthroughs/valid.md"),
      useGh: false,
    });
    expect(before.ok).toBe(true);

    repo.write("models/planning_pool_item.py", "# rewritten after the stamp\n");
    repo.commit("refactor: rewrite the pool item");

    const after = checkOne({
      cwd: repo.dir,
      path: join(repo.dir, "walkthroughs/valid.md"),
      useGh: false,
    });
    expect(after.ok).toBe(false);
    const overlap = after.diagnostics.find((diagnostic) => diagnostic.code === "stale-overlap");
    expect(overlap?.level).toBe("error");
    expect(overlap?.message).toContain("models/planning_pool_item.py");
    expect(overlap?.hint).toContain("re-stamp");
  });
});

describe("no walkthrough", () => {
  it("says so instead of failing", () => {
    const outcome = runCheck({ cwd: "/", useGh: false });
    expect(outcome.ok).toBe(true);
    expect(outcome.note).toBeTruthy();
  });
});
