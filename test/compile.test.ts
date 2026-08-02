import { basename } from "node:path";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest";
import { loadWalkthrough, type LoadResult } from "../src/compile/load.js";
import type { Payload } from "../src/payload/types.js";
import { sha256 } from "../src/resolve/hash.js";
import { firstBlock } from "./support/blocks.js";
import { createFixtureRepo, type FixtureRepo } from "./support/repo.js";

describe("compile", () => {
  let repo: FixtureRepo;
  let path: string;
  let loaded: LoadResult;
  let payload: Payload;

  beforeAll(async () => {
    repo = createFixtureRepo();
    path = repo.addWalkthrough("valid.md", "valid.md");
    loaded = await Effect.runPromise(loadWalkthrough({ cwd: repo.dir, path, useGh: false }));
    if (loaded.payload === null) throw new Error(JSON.stringify(loaded.diagnostics, null, 2));
    payload = loaded.payload;
  });

  afterAll(() => repo.cleanup());

  it("builds a payload with no error diagnostics", () => {
    expect(loaded.diagnostics.filter((d) => d.level === "error")).toEqual([]);
    expect(loaded.sourcePath).toBe("walkthroughs/valid.md");
  });

  it("carries the frontmatter envelope", () => {
    expect(payload.walkthrough).toBe(1);
    expect(payload.title).toBe("Add live planning pool items");
    expect(payload.commit).toBe(repo.pin);
    expect(payload.lang).toBe("en");
    expect(payload.meta).toEqual({ module: "acme_planning", lang: "en" });
    expect(payload.preset).toBeUndefined();
    expect(payload.storageKey).toBe(`balade:${basename(repo.dir)}#42:walkthroughs/valid.md`);
    expect(payload.pr.number).toBe(42);
    expect(payload.pr.base).toBe("main");
    expect(payload.pr.head).toBe("feature/pool");
    expect(payload.pr.stats.files).toBe(8);
  });

  it("derives the nav tree from groups and sections", () => {
    expect(payload.nav.map((node) => node.kind)).toEqual(["group", "group", "group"]);
    const models = payload.nav[1];
    if (models?.kind !== "group") throw new Error("expected a group");
    expect(models.label).toBe("Models");
    expect(models.children).toEqual([
      { kind: "file", label: "planning_pool_item.py", ref: "m-pool", status: "M" },
    ]);
    const orientation = payload.nav[0];
    if (orientation?.kind !== "group") throw new Error("expected a group");
    expect(orientation.children[0]).toEqual({
      kind: "section",
      label: "Overview",
      ref: "overview",
      icon: "list-unordered",
    });
  });

  it("resolves a code range with its change overlay", () => {
    const code = firstBlock(payload, "m-pool", "code");
    expect(code.lines).toHaveLength(16);
    expect(code.lines[0]).toBe("from odoo import api, fields, models");
    expect(code.lines[6]).toBe("    _auto = False");
    expect(code.lang).toBe("python");
    expect(code.view).toBe("change");
    expect(code.mark).toEqual([7]);
    expect(code.expect).toEqual({ value: "from odoo import api", status: "ok" });
    expect(code.changed).toEqual([1, 7, 11, 12, 13, 14, 15, 16]);
  });

  it("flattens rich text to the inline kinds", () => {
    const md = firstBlock(payload, "overview", "md");
    expect(md.nodes[0]).toEqual({
      p: [
        "Adds ",
        { c: "planning.pool.item" },
        ", a read-only lens over ",
        { b: ["converted"] },
        " allocations. It keeps allocation grain and exposes ",
        { i: ["total"] },
        ", ",
        { i: ["placed"] },
        " and ",
        { i: ["remaining"] },
        " charge.",
      ],
    });
    expect(md.nodes[1]).toEqual({ h: "What it does not do" });
    expect(md.nodes[2]).toEqual({
      list: [["It never creates shifts on its own."], ["It stores no number it can recompute."]],
    });
  });

  it("compiles the child-tag families", () => {
    expect(firstBlock(payload, "overview", "flow").steps).toEqual([
      { body: ["CRM opportunity"] },
      { body: ["allocation"], tag: "forecast" },
      { body: ["pool row shows up"] },
    ]);
    expect(firstBlock(payload, "overview", "cards").cols).toBe(2);
    expect(firstBlock(payload, "overview", "cards").items[0]?.title).toBe("One new model");
    expect(firstBlock(payload, "overview", "callout").tone).toBe("key");
    expect(firstBlock(payload, "m-pool", "attrs").items).toEqual([
      "_name = planning.pool.item",
      "_auto = False",
    ]);
    expect(firstBlock(payload, "m-pool", "fields").rows[0]).toEqual({
      name: "name",
      kind: "Char",
      badges: ["computed"],
      tags: ["index=True"],
      note: ["Human label for the pool row."],
    });
    const method = firstBlock(payload, "m-pool", "method");
    expect(method.sig).toBe("_compute_placed()");
    expect(method.chips).toBeUndefined();
    expect(firstBlock(payload, "tests", "tests").items[0]).toEqual({
      name: "test_pool_grain",
      kind: "unit",
      scenario: ["Creates allocations in every state, then reads the pool view."],
      asserts: [["One row per allocation."], ["Cancelled allocations produce nothing."]],
    });
    expect(firstBlock(payload, "patterns", "patterns").items[0]?.term).toBe("SQL-view model");
  });

  it("turns a matrix into ticks and a native table into a table block", () => {
    expect(firstBlock(payload, "security", "matrix")).toEqual({
      b: "matrix",
      head: ["ACL · group", "read", "write", "create", "unlink"],
      rows: [{ label: "pool · user", cells: [true, false, false, false] }],
    });
    const table = firstBlock(payload, "security", "table");
    expect(table.head).toEqual([["File"], ["Intent"]]);
    expect(table.rows).toEqual([[[{ c: "ir.model.access.csv" }], ["read-only access"]]]);
    expect(table.firstColMono).toBe(true);
  });

  it("computes the diagram from plain attribute data", () => {
    const diagram = firstBlock(payload, "map", "diagram");
    expect(diagram.intro).toEqual(["Click a box to jump to its detail card."]);
    expect(diagram.nodes[0]).toEqual({
      id: "n-pool",
      model: "planning.pool.item",
      change: "new",
      badge: "new",
      ref: "m-pool",
      col: 1,
      row: 1,
      compartments: [{ label: "SQL view", rows: [["allocation_id"], ["placed"]] }],
    });
    expect(diagram.edges[0]).toEqual({
      from: "n-slot",
      to: "n-pool",
      kind: "new",
      label: "allocation_id",
      thick: true,
    });
  });

  it("resolves files, their refs and the author's why", () => {
    const files = firstBlock(payload, "files", "files");
    expect([...files.paths].sort()).toEqual([
      "docs/old.md",
      "i18n/acme.pot",
      "i18n/fr.po",
      "models/planning_allocation.py",
      "models/planning_pool_item.py",
      "security/ir.model.access.csv",
      "utils/planning_helper.py",
      "views/planning_pool_views.xml",
    ]);
    const deleted = payload.files.find((entry) => entry.path === "docs/old.md");
    expect(deleted?.status).toBe("D");
    expect(deleted?.why).toBe("superseded by the pool item");
    expect(deleted?.ref).toBe("files");
    expect(payload.files.find((entry) => entry.path === "models/planning_pool_item.py")?.ref).toBe(
      "m-pool",
    );
    const added = payload.files.find((entry) => entry.path === "models/planning_allocation.py");
    expect(added?.status).toBe("A");
    expect(added?.diff?.oldContent).toBeNull();
    expect(added?.diff?.newContent).toContain("class PlanningAllocation");
    expect(added?.diff?.unified.startsWith("@@")).toBe(true);
  });

  it("resolves a pure rename and a moved-and-edited file", () => {
    const renamed = payload.files.find((entry) => entry.path === "views/planning_pool_views.xml");
    expect(renamed).toMatchObject({
      status: "R",
      oldPath: "views/pool_views.xml",
      additions: 0,
      deletions: 0,
      lang: "xml",
    });
    /* A pure rename has no hunks: both sides are the same bytes. */
    expect(renamed?.diff?.unified).toBe("");
    expect(renamed?.diff?.newContent).toContain("planning.pool.item.list");
    expect(renamed?.diff?.oldContent).toBe(renamed?.diff?.newContent);

    const moved = payload.files.find((entry) => entry.path === "utils/planning_helper.py");
    expect(moved).toMatchObject({ status: "R", oldPath: "models/planning_helper.py" });
    expect(moved?.additions).toBeGreaterThan(0);
    expect(moved?.deletions).toBeGreaterThan(0);
    expect(moved?.diff?.unified).toContain("+    live = [slot for slot in slots if is_live(slot)]");
    expect(moved?.diff?.oldContent).toContain('"""Spread a charge over the given slots."""');
    expect(moved?.diff?.newContent).toContain("ignoring cancelled ones");
  });

  it("keys a body-less rename on its own path and blob", () => {
    const renamed = payload.files.find((entry) => entry.path === "views/planning_pool_views.xml");
    expect(renamed?.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(renamed?.hash).not.toBe(sha256(""));
    const hashes = new Set(payload.files.map((entry) => entry.hash));
    expect(hashes.size).toBe(payload.files.length);
  });

  it("counts gettext entries for the i18n block", () => {
    const i18n = firstBlock(payload, "i18n", "i18n");
    const fr = i18n.rows.find((row) => row.path === "i18n/fr.po");
    expect(fr).toMatchObject({ status: "M", lang: "fr", entries: { new: 1, updated: 1 } });
    const pot = i18n.rows.find((row) => row.path === "i18n/acme.pot");
    expect(pot?.lang).toBeUndefined();
    expect(pot?.entries).toEqual({ new: 3 });
  });

  it.effect("hashes sections and files reproducibly", () =>
    Effect.gen(function* () {
      const again = (yield* loadWalkthrough({ cwd: repo.dir, path, useGh: false })).payload;
      expect(again).not.toBeNull();
      for (const section of payload.sections) {
        expect(section.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(again?.sections.find((entry) => entry.id === section.id)?.hash).toBe(section.hash);
      }
      const unique = new Set(payload.sections.map((section) => section.hash));
      expect(unique.size).toBe(payload.sections.length);
      for (const file of payload.files) {
        expect(file.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(again?.files.find((entry) => entry.path === file.path)?.hash).toBe(file.hash);
      }
    }),
  );
});
