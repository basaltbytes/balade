import { describe, expect, it } from "vitest";
import { plainHeadings, renderProse } from "../src/authoring/prose.js";

describe("renderProse", () => {
  it("fails on a placeholder no slot fills, instead of shipping a hole in a prompt", () => {
    expect(() => renderProse("a {{missing}} b", {})).toThrow("{{missing}}");
  });

  it("fails on a slot whose placeholder was edited away, so a rename cannot go stale silently", () => {
    expect(() => renderProse("no placeholders", { orphan: "text" })).toThrow("orphan");
  });

  it("fails on a malformed placeholder instead of passing it through as prose", () => {
    expect(() => renderProse("a {{Bad Name}} b", {})).toThrow("malformed");
  });
});

describe("plainHeadings", () => {
  it("renders only `## ` document headings bare, leaving deeper headings to the shared prose", () => {
    expect(plainHeadings("## Title\n### Sub\ntext ## not a heading")).toBe(
      "Title\n### Sub\ntext ## not a heading",
    );
  });
});
