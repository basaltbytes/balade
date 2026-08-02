import { describe, expect, it } from "vitest";
import { compileBlocks, parseMark, type CompileEnv } from "../src/compile/blocks.js";
import { diagramNodes } from "../src/compile/diagram.js";
import { inlineOf, mdNodesOf, plainText } from "../src/compile/inline.js";
import { parseDocument } from "../src/compile/document.js";
import type { Block, CheckDiagnostic } from "../src/payload/types.js";
import type { ResolveContext } from "../src/resolve/context.js";
import { changedLines, splitDiff } from "../src/resolve/diff.js";
import { countEntries, parsePo, poLanguage } from "../src/resolve/gettext.js";
import { matchesGlob } from "../src/resolve/glob.js";
import { sha256 } from "../src/resolve/hash.js";
import { langOf } from "../src/resolve/lang.js";

const DIFF = `diff --git a/models/pool.py b/models/pool.py
index 1111111..2222222 100644
--- a/models/pool.py
+++ b/models/pool.py
@@ -1 +1 @@
-from odoo import fields, models
+from odoo import api, fields, models
@@ -6,0 +7 @@ class PoolItem(models.Model):
+    _auto = False
@@ -9,0 +11,6 @@ class PoolItem(models.Model):
+    placed = fields.Float()
+
+    @api.depends("slot_ids")
+    def _compute_placed(self):
+        for item in self:
+            item.placed = 0.0
diff --git a/docs/old.md b/docs/old.md
deleted file mode 100644
index 3333333..0000000
--- a/docs/old.md
+++ /dev/null
@@ -1 +0,0 @@
-# Superseded
`;

describe("unified diff", () => {
  it("splits one diff into per-file records", () => {
    const records = splitDiff(DIFF);
    expect(records.map((record) => record.path)).toEqual(["models/pool.py", "docs/old.md"]);
    expect(records[0]?.body.startsWith("@@ -1 +1 @@")).toBe(true);
    expect(records[0]?.binary).toBe(false);
    expect(records[1]?.path).toBe("docs/old.md");
  });

  it("reads the change overlay off the hunk headers", () => {
    const record = splitDiff(DIFF)[0];
    expect([...changedLines(record?.body ?? "")]).toEqual([1, 7, 11, 12, 13, 14, 15, 16]);
  });

  it("marks a deleted file as changing nothing on the new side", () => {
    const record = splitDiff(DIFF)[1];
    expect([...changedLines(record?.body ?? "")]).toEqual([]);
  });

  it("reads a binary record", () => {
    const records = splitDiff(
      "diff --git a/logo.png b/logo.png\nindex 1111111..2222222 100644\nBinary files a/logo.png and b/logo.png differ\n",
    );
    expect(records[0]).toMatchObject({ path: "logo.png", binary: true, body: "" });
  });
});

describe("gettext", () => {
  const before = `msgid ""
msgstr "header"

msgid "Pool item"
msgstr "Élément du pool"

msgid "Gone"
msgstr "Parti"
`;
  const after = `msgid ""
msgstr "header"

msgid "Pool item"
msgstr "Élément de pool"

msgid "Placed"
msgstr "Placé"
`;

  it("reads msgid/msgstr pairs and skips the header", () => {
    expect([...parsePo(before).keys()]).toEqual(["Pool item", "Gone"]);
  });

  it("joins multi-line strings", () => {
    const entries = parsePo('msgid "Long "\n"label"\nmsgstr "Étiquette "\n"longue"\n');
    expect(entries.get("Long label")).toBe("Étiquette longue");
  });

  it("counts new, updated and removed entries", () => {
    expect(countEntries(before, after)).toEqual({ new: 1, updated: 1, removed: 1 });
    expect(countEntries(null, after)).toEqual({ new: 2 });
    expect(countEntries(before, before)).toEqual({});
  });

  it("reads the language from the file name", () => {
    expect(poLanguage("i18n/fr.po")).toBe("fr");
    expect(poLanguage("i18n/acme.pot")).toBeNull();
  });
});

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
    blob: () => null,
  };

  function compile(body: string): { blocks: Block[]; diagnostics: CheckDiagnostic[] } {
    const doc = parseDocument(
      `---\nwalkthrough: 1\ntitle: T\npr: 1\ncommit: abc1234\n---\n\n${body}\n`,
      "w.md",
    );
    const section = doc.ast.children.find((node) => node.tag === "section");
    if (section === undefined) throw new Error("no section");
    const diagnostics: CheckDiagnostic[] = [];
    const env: CompileEnv = {
      file: "w.md",
      ctx: stubContext,
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
