import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { stringify as stringifyYaml } from "yaml";
import { Frontmatter as FrontmatterSchema } from "../src/payload/schema.js";
import { parseFrontmatter } from "../src/schema/frontmatter.js";

describe("frontmatter schema diagnostics", () => {
  it.prop(
    "round-trips schema-shaped values through YAML",
    { expected: Schema.toArbitrary(FrontmatterSchema) },
    ({ expected }) => {
      expect(parseFrontmatter(stringifyYaml(expected), "walkthroughs/property.md")).toEqual({
        frontmatter: expected,
        diagnostics: [],
      });
    },
  );

  it("keeps optional-field errors non-blocking and normalizes valid metadata scalars", () => {
    const result = parseFrontmatter(
      [
        "walkthrough: 1",
        "title: T",
        "pr: 7",
        "commit: abc1234",
        "mystery: x",
        "preset: 7",
        "meta:",
        "  module: 42",
        "  bad:",
        "    nested: true",
      ].join("\n"),
      "walkthroughs/one.md",
    );

    expect(result.frontmatter).toEqual({
      walkthrough: 1,
      title: "T",
      pr: 7,
      commit: "abc1234",
      meta: { module: "42" },
    });
    expect(result.diagnostics).toEqual([
      {
        code: "frontmatter-key-unknown",
        level: "error",
        file: "walkthroughs/one.md",
        line: 6,
        message: "Unknown frontmatter key `mystery`.",
        hint: "Keep domain keys under `meta`: meta:\n  mystery: …",
      },
      {
        code: "frontmatter-invalid",
        level: "error",
        file: "walkthroughs/one.md",
        line: 7,
        message: "`preset` must be a preset name.",
        hint: "Write `preset: odoo`.",
      },
      {
        code: "frontmatter-invalid",
        level: "error",
        file: "walkthroughs/one.md",
        line: 8,
        message: "`meta.bad` must be a scalar.",
        hint: "Meta values render as header chips; keep them short strings.",
      },
    ]);
  });

  it("preserves prototype-named metadata keys as own data", () => {
    const result = parseFrontmatter(
      ["walkthrough: 1", "title: T", "pr: 7", "commit: abc1234", "meta:", "  __proto__: kept"].join(
        "\n",
      ),
      "walkthroughs/one.md",
    );

    expect(result.frontmatter?.meta["__proto__"]).toBe("kept");
    expect(Object.hasOwn(result.frontmatter?.meta ?? {}, "__proto__")).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it("maps required-field schema issues to the established messages and lines", () => {
    const result = parseFrontmatter(
      ["walkthrough: 2", "title: 7", 'pr: "7"', "commit: nope"].join("\n"),
      "w.md",
    );

    expect(result.frontmatter).toBeNull();
    expect(result.diagnostics.map(({ line, message }) => ({ line, message }))).toEqual([
      { line: 2, message: "Unsupported schema version `2`." },
      { line: 3, message: "`title` must be a string." },
      { line: 4, message: "`pr` must be the pull-request number." },
      { line: 5, message: "`commit` must be the stamped commit SHA." },
    ]);
    expect(result.diagnostics.every((diagnostic) => diagnostic.hint !== undefined)).toBe(true);
  });
});
