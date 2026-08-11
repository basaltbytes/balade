import { Option } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { compileBlocks, parseMark, type CompileEnv } from "../src/walkthrough/blocks.js";
import { diagramNodes, MAX_DIAGRAM_GRID_SIZE } from "../src/contract/diagram.js";
import { inlineOf, mdNodesOf, plainText } from "../src/walkthrough/inline.js";
import { parseDocument } from "../src/walkthrough/document.js";
import type { Block, CheckDiagnostic } from "../src/contract/types.js";
import type { ResolveContext } from "../src/contract/context.js";
import { matchesGlob } from "../src/walkthrough/glob.js";
import { sha256 } from "../src/contract/hash.js";
import { langOf } from "../src/contract/lang.js";

describe("small pure helpers", () => {
  it("matches path globs", () => {
    expect(matchesGlob("models/pool.py", "models/**")).toBe(true);
    expect(matchesGlob("models/sub/pool.py", "models/**")).toBe(true);
    expect(matchesGlob("views/pool.xml", "models/**")).toBe(false);
    expect(matchesGlob("models/pool.py", "**/*.py")).toBe(true);
    expect(matchesGlob("pool.py", "**/*.py")).toBe(true);
    expect(matchesGlob("i18n/fr.po", "i18n/*.{po,pot}")).toBe(true);
    expect(matchesGlob("i18n/sub/fr.po", "i18n/*.{po,pot}")).toBe(false);
  });

  it("parses mark ranges in both notations", () => {
    expect(parseMark("12-14,20")).toEqual([12, 13, 14, 20]);
    expect(parseMark([2, 3])).toEqual([2, 3]);
    expect(parseMark(undefined)).toEqual([]);
  });

  it("detects highlight languages", () => {
    expect(langOf("models/pool.py")).toBe("python");
    expect(langOf("i18n/fr.po")).toBe("po");
    expect(langOf("security/ir.model.access.csv")).toBe("csv");
    expect(langOf("Makefile")).toBe("makefile");
    expect(langOf("LICENSE")).toBe("text");
  });

  it("hashes with a stable prefix", () => {
    expect(sha256("balade")).toBe(sha256("balade"));
    expect(sha256("balade")).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(sha256("a")).not.toBe(sha256("b"));
  });

  it("coerces diagram nodes from plain data", () => {
    expect(diagramNodes([{ id: "n1", model: "m", change: "bogus", col: 2, row: 3 }])[0]).toEqual({
      id: "n1",
      model: "m",
      change: "ctx",
      col: 2,
      row: 3,
      compartments: [],
    });
  });

  it("clamps diagram coordinates before they enter the payload", () => {
    const [node] = diagramNodes([{ id: "n1", model: "m", col: 999_999_999, row: -999_999_999 }]);

    expect(node).toMatchObject({ col: MAX_DIAGRAM_GRID_SIZE, row: 1 });
  });
});

describe("blocks without a repository", () => {
  const stubContext: ResolveContext = {
    repoRoot: "/tmp/none",
    repoSlug: "acme/none",
    pin: "0".repeat(40),
    baseSha: "1".repeat(40),
    headSha: "0".repeat(40),
    headDistance: 0,
    touched: new Set(),
    pr: {
      number: 1,
      url: "https://example.test/pull/1",
      author: "octocat",
      state: "open",
      base: "main",
      head: "feature",
      commits: 1,
      stats: { files: 0, additions: 0, deletions: 0 },
    },
    files: [],
    changed: new Map(),
    blob: () => Option.none(),
  };

  function compile(
    body: string,
    ctx: ResolveContext = stubContext,
  ): { blocks: Block[]; diagnostics: CheckDiagnostic[] } {
    const doc = parseDocument(
      `---\nwalkthrough: 1\ntitle: T\npr: 1\ncommit: abc1234\n---\n\n${body}\n`,
      "w.md",
    );
    const section = doc.ast.children.find((node) => node.tag === "section");
    if (section === undefined) throw new Error("no section");
    const diagnostics: CheckDiagnostic[] = [];
    const env: CompileEnv = {
      file: "w.md",
      ctx,
      preset: undefined,
      fileEntry: () => undefined,
      report: (diagnostic) => diagnostics.push(diagnostic),
      echo: () => {},
      card: () => {},
      markReferenced: () => {},
      fileRef: () => {},
      fileWhy: () => {},
    };
    return { blocks: compileBlocks(section.children, env, "s"), diagnostics };
  }

  it("reads Markdoc's own table syntax as well as pipe tables", () => {
    const { blocks } = compile(
      [
        '{% section id="s" title="T" %}',
        "{% table %}",
        "* Model",
        "* read",
        "---",
        "* pool",
        "* yes",
        "{% /table %}",
        "{% /section %}",
      ].join("\n"),
    );
    expect(blocks[0]).toEqual({
      b: "table",
      head: [["Model"], ["read"]],
      rows: [[["pool"], ["yes"]]],
    });
  });

  it("reports a matrix with no table", () => {
    const { blocks, diagnostics } = compile(
      [
        '{% section id="s" title="T" %}',
        "{% matrix %}",
        "nothing",
        "{% /matrix %}",
        "{% /section %}",
      ].join("\n"),
    );
    expect(blocks[0]).toEqual({ b: "matrix", head: [], rows: [] });
    expect(diagnostics[0]?.code).toBe("matrix-empty");
    expect(diagnostics[0]?.hint).toBeTruthy();
  });

  it("sends the author to git instead of a fenced snippet", () => {
    const { diagnostics } = compile(
      ['{% section id="s" title="T" %}', "```python", "print(1)", "```", "{% /section %}"].join(
        "\n",
      ),
    );
    expect(diagnostics[0]?.code).toBe("fence-unsupported");
    expect(diagnostics[0]?.hint).toContain("{% code");
  });

  it("keeps a mermaid fence in place between the prose around it", () => {
    const { blocks, diagnostics } = compile(
      [
        '{% section id="s" title="T" %}',
        "Before.",
        "",
        "```mermaid",
        "graph TD",
        "  a --> b",
        "```",
        "",
        "After.",
        "{% /section %}",
      ].join("\n"),
    );

    expect(diagnostics).toEqual([]);
    expect(blocks).toEqual([
      { b: "md", nodes: [{ p: ["Before."] }] },
      { b: "mermaid", source: "graph TD\n  a --> b" },
      { b: "md", nodes: [{ p: ["After."] }] },
    ]);
  });

  /* A blockquote reaches the payload as markdown flow, so the fence inside it is
     collected with the others and loses the position a top-level fence keeps. */
  it("leaves a mermaid fence unsupported when a blockquote holds it", () => {
    const { blocks, diagnostics } = compile(
      [
        '{% section id="s" title="T" %}',
        "> Quoted.",
        "> ",
        "> ```mermaid",
        "> graph TD",
        "> ```",
        "{% /section %}",
      ].join("\n"),
    );

    expect(diagnostics[0]?.code).toBe("fence-unsupported");
    expect(blocks.map((block) => block.b)).toEqual(["md"]);
  });

  it("carries an authored collapsed, and stays thin without one", () => {
    const source = ["from odoo import api", "", "class PlanningPoolItem:"];
    const withSource: ResolveContext = { ...stubContext, blob: () => Option.some(source) };
    const codeSection = (attributes: string): string =>
      [
        '{% section id="s" title="T" %}',
        `{% code file="models/planning_pool_item.py" from=1 to=3 expect="from odoo import api"${attributes} /%}`,
        "{% /section %}",
      ].join("\n");

    expect(compile(codeSection(" collapsed=true"), withSource).blocks[0]).toMatchObject({
      b: "code",
      collapsed: true,
    });

    for (const attributes of ["", " collapsed=false"]) {
      const block = compile(codeSection(attributes), withSource).blocks[0];
      expect(block).toMatchObject({ b: "code" });
      expect(block).not.toHaveProperty("collapsed");
    }
  });
});

describe("frontmatter and rich text", () => {
  it("accepts the envelope and rejects an unknown key", () => {
    const doc = parseDocument(
      [
        "---",
        "walkthrough: 1",
        "title: T",
        "pr: 7",
        "commit: abc1234",
        "module: acme",
        "---",
        "",
        "text",
      ].join("\n"),
      "w.md",
    );
    expect(doc.frontmatter).toMatchObject({ title: "T", pr: 7, commit: "abc1234" });
    const unknown = doc.diagnostics.find(
      (diagnostic) => diagnostic.code === "frontmatter-key-unknown",
    );
    expect(unknown?.line).toBe(6);
    expect(unknown?.hint).toContain("meta");
  });

  it("stops on a missing required key", () => {
    const doc = parseDocument(["---", "title: T", "---", ""].join("\n"), "w.md");
    expect(doc.frontmatter).toBeNull();
    expect(doc.diagnostics.map((diagnostic) => diagnostic.code)).toContain("frontmatter-invalid");
  });

  it("reports a missing frontmatter", () => {
    const doc = parseDocument("# no frontmatter\n", "w.md");
    expect(doc.diagnostics[0]?.code).toBe("frontmatter-missing");
    expect(doc.diagnostics[0]?.hint).toBeTruthy();
  });

  it("flattens markdown to inline and md nodes", () => {
    const doc = parseDocument(
      "---\nwalkthrough: 1\ntitle: T\npr: 1\ncommit: abc1234\n---\n\nA **b** `c` *d*.\n\n1. one\n2. two\n",
      "w.md",
    );
    const { nodes } = mdNodesOf(doc.ast.children);
    expect(nodes[0]).toEqual({ p: ["A ", { b: ["b"] }, " ", { c: "c" }, " ", { i: ["d"] }, "."] });
    expect(nodes[1]).toEqual({ list: [["one"], ["two"]], ordered: true });
    expect(plainText(inlineOf([]))).toBe("");
  });
});
