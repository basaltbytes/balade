import { basename } from "node:path";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest";
import { loadWalkthrough, type LoadResult } from "../src/walkthrough/pipeline.js";
import type { Payload } from "../src/contract/types.js";
import { sha256 } from "../src/contract/hash.js";
import { firstBlock } from "./support/blocks.js";
import { provideLive } from "./support/effect.js";
import { createFixtureRepo, type FixtureRepo } from "./support/repo.js";

describe("compile", () => {
  let repo: FixtureRepo;
  let path: string;
  let loaded: LoadResult;
  let payload: Payload;

  beforeAll(async () => {
    repo = createFixtureRepo();
    path = repo.addWalkthrough("valid.md", "valid.md");
    loaded = await Effect.runPromise(
      provideLive(loadWalkthrough({ cwd: repo.dir, path, useGh: false })),
    );
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
    /* No `filegroup` authored: the block carries rows only. */
    expect(files.groups).toBeUndefined();
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
    expect(deleted?.ref).toBe("patterns");
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
      const again = (yield* provideLive(loadWalkthrough({ cwd: repo.dir, path, useGh: false })))
        .payload;
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

describe("compile with file groups", () => {
  let repo: FixtureRepo;
  let loaded: LoadResult;
  let payload: Payload;

  const groupOf = (sectionId: string, label: string): readonly string[] => {
    const group = firstBlock(payload, sectionId, "files").groups?.find(
      (entry) => entry.label === label,
    );
    if (group === undefined) throw new Error(`no group ${label} in ${sectionId}`);
    return [...group.paths].sort();
  };

  beforeAll(async () => {
    repo = createFixtureRepo();
    const path = repo.addWalkthrough("filegroups.md", "filegroups.md");
    loaded = await Effect.runPromise(
      provideLive(loadWalkthrough({ cwd: repo.dir, path, useGh: false })),
    );
    if (loaded.payload === null) throw new Error(JSON.stringify(loaded.diagnostics, null, 2));
    payload = loaded.payload;
  });

  afterAll(() => repo.cleanup());

  it("keeps a grouped closing block a valid full-PR list", () => {
    expect(loaded.diagnostics.filter((d) => d.level === "error")).toEqual([]);
  });

  it("partitions the pool into the authored groups, leftovers in paths", () => {
    const files = firstBlock(payload, "grouped", "files");
    expect(files.groups?.map((group) => group.label)).toEqual(["Translations", "Models", "Python"]);
    expect(groupOf("grouped", "Translations")).toEqual(["i18n/acme.pot", "i18n/fr.po"]);
    expect(groupOf("grouped", "Models")).toEqual([
      "models/planning_allocation.py",
      "models/planning_pool_item.py",
    ]);
    /* The Python glob overlaps the models one; the earlier group already claimed them. */
    expect(groupOf("grouped", "Python")).toEqual(["utils/planning_helper.py"]);
    expect([...files.paths].sort()).toEqual([
      "docs/old.md",
      "security/ir.model.access.csv",
      "views/planning_pool_views.xml",
    ]);
    const all = [...(files.groups ?? []).flatMap((group) => group.paths), ...files.paths];
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(payload.files.length);
  });

  it("warns about a group that claims nothing", () => {
    const empty = loaded.diagnostics.filter((d) => d.code === "filegroup-empty");
    expect(empty).toHaveLength(1);
    expect(empty[0]?.level).toBe("warning");
    expect(empty[0]?.message).toContain("Static assets");
    expect(empty[0]?.hint).toContain('only="static/**"');
    /* Warned, then dropped: every group in the payload holds rows. */
    expect(
      firstBlock(payload, "grouped", "files").groups?.some((group) => group.paths.length === 0),
    ).toBe(false);
  });

  it("lets a filter-less group claim the rest of the pool", () => {
    const files = firstBlock(payload, "closing", "files");
    expect(files.groups?.map((group) => group.label)).toEqual(["New files", "Everything else"]);
    expect(groupOf("closing", "New files")).toEqual([
      "i18n/acme.pot",
      "models/planning_allocation.py",
      "security/ir.model.access.csv",
    ]);
    expect(groupOf("closing", "Everything else")).toEqual([
      "docs/old.md",
      "i18n/fr.po",
      "models/planning_pool_item.py",
      "utils/planning_helper.py",
      "views/planning_pool_views.xml",
    ]);
    /* The block holds every file through its groups: no `files-empty`. */
    expect(files.paths).toEqual([]);
    expect(loaded.diagnostics.filter((d) => d.code === "files-empty")).toEqual([]);
  });

  it("refs and explains a grouped path like an ungrouped one", () => {
    const grouped = payload.files.find((entry) => entry.path === "i18n/fr.po");
    expect(grouped?.ref).toBe("grouped");
    expect(grouped?.why).toBe("one new label");
    const leftover = payload.files.find((entry) => entry.path === "docs/old.md");
    expect(leftover?.ref).toBe("grouped");
    expect(leftover?.why).toBe("superseded by the pool item");
  });
});
