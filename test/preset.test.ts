import { join } from "node:path";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest";
import { checkOne } from "../src/check/run.js";
import { loadWalkthrough } from "../src/compile/load.js";
import type { Payload } from "../src/payload/types.js";
import { getPreset, presetNames, presetOfTag } from "../src/preset/registry.js";
import { firstBlock } from "./support/blocks.js";
import { provideLive } from "./support/effect.js";
import { createFixtureRepo, type FixtureRepo } from "./support/repo.js";

describe("preset registry", () => {
  it("keys presets by name and tags by prefix", () => {
    expect(presetNames()).toEqual(["odoo"]);
    expect(getPreset("odoo")?.prefix).toBe("o-");
    expect(getPreset("sap")).toBeUndefined();
    expect(presetOfTag("o-field")?.name).toBe("odoo");
    expect(presetOfTag("code")).toBeUndefined();
  });
});

describe("odoo preset", () => {
  let repo: FixtureRepo;
  let payload: Payload;

  beforeAll(async () => {
    repo = createFixtureRepo();
    repo.addWalkthrough("odoo.md", "odoo.md");
    repo.addWalkthrough("unknown-preset.md", "unknown-preset.md");
    const loaded = await Effect.runPromise(
      provideLive(
        loadWalkthrough({
          cwd: repo.dir,
          path: join(repo.dir, "walkthroughs/odoo.md"),
          useGh: false,
        }),
      ),
    );
    if (loaded.payload === null) throw new Error(JSON.stringify(loaded.diagnostics, null, 2));
    payload = loaded.payload;
  });

  afterAll(() => repo.cleanup());

  it("activates the preset from the frontmatter", () => {
    expect(payload.preset).toBe("odoo");
  });

  it("expands o-field to core field rows with kind chips", () => {
    const rows = firstBlock(payload, "m-pool", "fields").rows;
    expect(rows[0]).toEqual({
      name: "allocation_id",
      kind: "Many2one",
      badges: ["readonly"],
      tags: ["→ planning.allocation"],
      note: ["The source row this lens reflects."],
    });
    expect(rows[2]).toEqual({
      name: "name",
      kind: "Char · compute",
      badges: ["computed"],
      note: ["Human label."],
    });
  });

  it("adds decorator chips to a core method", () => {
    expect(firstBlock(payload, "m-pool", "method").chips).toEqual(["depends"]);
  });

  it.effect("fails a relational field with no comodel", () =>
    Effect.gen(function* () {
      const report = yield* provideLive(
        checkOne({
          cwd: repo.dir,
          path: join(repo.dir, "walkthroughs/odoo.md"),
          useGh: false,
        }),
      );
      expect(report.ok).toBe(false);
      const missing = report.diagnostics.filter(
        (diagnostic) => diagnostic.code === "odoo-comodel-missing",
      );
      expect(missing).toHaveLength(1);
      expect(missing[0]?.message).toContain("slot_ids");
      expect(missing[0]?.hint).toContain("comodel");
    }),
  );

  it.effect("names the known presets when the frontmatter asks for one it does not have", () =>
    Effect.gen(function* () {
      const report = yield* provideLive(
        checkOne({
          cwd: repo.dir,
          path: join(repo.dir, "walkthroughs/unknown-preset.md"),
          useGh: false,
        }),
      );
      expect(report.ok).toBe(false);
      const unknown = report.diagnostics.find((diagnostic) => diagnostic.code === "preset-unknown");
      expect(unknown?.message).toContain("sap");
      expect(unknown?.hint).toContain("odoo");
    }),
  );
});
