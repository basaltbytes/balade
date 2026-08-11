// @vitest-environment jsdom

/* Real mermaid over an adversarial diagram source. jsdom implements no SVG text
   metrics, so the three measurement calls mermaid's layout makes are given
   fixed answers here — the same kind of environment fill-in as the `webcrypto`
   swap in `widgets/code-diff-link.test.tsx`, not a stand-in for mermaid. */

import { describe, expect, it } from "vitest";
import { lazyMermaidRenderer, sanitizeDiagramSvg } from "./mermaid";

const box = { x: 0, y: 0, width: 40, height: 16, top: 0, left: 0, right: 40, bottom: 16 };

Object.defineProperties(globalThis.SVGElement.prototype, {
  getBBox: { configurable: true, value: () => box },
  getComputedTextLength: { configurable: true, value: () => 40 },
  getSubStringLength: { configurable: true, value: () => 40 },
});

const hasAnchor = (markup: string): boolean => /<a[\s>]/i.test(markup);

describe("mermaid over an untrusted diagram source", () => {
  it("keeps a script out of a label and a link out of the injected markup", async () => {
    const svg = await lazyMermaidRenderer.render(
      "test-strict",
      [
        "graph TD",
        '  a["<script>globalThis.pwned = true;</script>"] --> b',
        '  click a href "https://evil.example/"',
      ].join("\n"),
    );

    /* Strict mode sanitizes the label, but it leaves the anchor standing: the
       sink guard is what holds the "a walkthrough expresses no link" rule. */
    expect(svg).not.toMatch(/<script/i);
    expect(hasAnchor(svg)).toBe(true);

    const clean = sanitizeDiagramSvg(svg);
    expect(hasAnchor(clean)).toBe(false);
    expect(clean).not.toContain("evil.example");
    expect(clean).not.toMatch(/<script/i);
  });

  it("refuses a directive that would downgrade the security level", async () => {
    const svg = await lazyMermaidRenderer.render(
      "test-directive-security",
      [
        '%%{init: {"securityLevel": "loose"}}%%',
        "graph TD",
        '  a["<script>globalThis.pwned = true;</script>"] --> b',
        '  click a href "javascript:globalThis.pwned = true"',
      ].join("\n"),
    );

    /* A loose level would keep the URL verbatim and skip the output sanitization
       that removed the script — both of these would be in the markup. */
    expect(svg).not.toContain("javascript:");
    expect(svg).not.toMatch(/<script/i);
  });

  /* HTML labels are on by default even under `securityLevel: "strict"`, and a
     directive can flip the switch, so the diagram source is where they would
     come back if `secure` did not hold the key. */
  it("refuses a directive that would put labels back into HTML", async () => {
    const svg = await lazyMermaidRenderer.render(
      "test-directive-labels",
      [
        '%%{init: {"htmlLabels": true, "flowchart": {"htmlLabels": true}}}%%',
        "graph TD",
        '  a["label"] --> b',
      ].join("\n"),
    );

    expect(svg).not.toMatch(/foreignObject/i);
    expect(svg).toMatch(/<tspan/i);
  });
});
