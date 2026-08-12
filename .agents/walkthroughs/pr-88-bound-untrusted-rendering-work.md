---
walkthrough: 1
title: Bound untrusted rendering work
pr: 88
commit: 89a02f181ef190f0b73e8ed0a14eadc72856c630
meta:
  pr: "88"
  commit: 89a02f1
  scope: availability safeguards
  balade-authoring: 1.9.0
---

{% group label="Orientation" %}
{% section id="overview" title="Overview" related=["highlighting", "input-boundaries", "proof"] %}
This change limits expensive work on pull-request input. A crafted line, diagram coordinate, frontmatter key, or ref name can no longer make the renderer or CLI perform unbounded or unintended parsing work.

The main design constraint is that the payload schema stays shape-only. Each consumer applies the limit at the point where cost starts. This protects both CLI-produced payloads and payloads loaded through ref or export paths.

{% callout tone="key" %}
The syntax limit is per line, not per block or file. A line longer than 2,000 characters disables grammar work for the affected code or diff content, but the text remains visible.
{% /callout %}
{% /section %}
{% /group %}

{% group label="Surface" %}
{% section id="highlighting" title="Safe plaintext highlighting fallback" related=["proof"] %}
The shared highlighter scans line boundaries before it selects a grammar. An overlong line selects `text`; unknown language identifiers also resolve to `text`.

{% code file="app/src/highlight/shiki.ts" from=15 to=28 expect="export const THEME = \"github-dark-default\";" /%}

Code excerpts use the same length check before rendering. An affected excerpt shows a localized notice and uses React's escaped text path instead of injected Shiki HTML.

{% code file="app/src/widgets/code.tsx" from=20 to=38 expect="export function Code({ block }: { block: CodeBlock }) {" /%}

The diff adapter keeps plaintext inside the custom Shiki path. It treats `text` as registered, so unknown or plaintext languages do not fall through to the diff library's automatic language detection. If registry inspection or AST rendering fails, the adapter reports the typed failure and returns an AST with only the raw text node.

{% code file="app/src/highlight/diff-highlighter.ts" from=27 to=79 expect="const plaintextAst = (raw: string): DiffAST => ({" /%}

{% fields %}
{% field name="HighlightLoadFailed" kind="tagged error" %}Preserves failures while the Shiki instance or grammar chunks load.{% /field %}
{% field name="HighlightRenderFailed" kind="tagged error" %}Names HTML or AST rendering failure and the selected language.{% /field %}
{% field name="HighlightLanguageCheckFailed" kind="tagged error" %}Preserves a failure while the diff adapter checks the loaded-language registry.{% /field %}
{% /fields %}

{% code file="app/src/highlight/shiki.ts" from=96 to=124 expect="export class HighlightLoadFailed extends Schema.TaggedErrorClass<HighlightLoadFailed>()(" /%}

Diff highlighting also stays disabled until the custom adapter is ready. CSV and PO grammars load through the curated Shiki registry. These paths prevent `highlightAuto` from receiving pull-request bytes.
{% /section %}
{% /group %}

{% group label="Deep dive" %}
{% section id="input-boundaries" title="Limits at the remaining input boundaries" related=["proof"] %}
Diagram coordinates have two guards. The CLI transform converts values to integers and clamps them to the inclusive range 1–64 before it creates payload nodes.

{% code file="src/contract/diagram.ts" from=21 to=54 expect="function gridCoordinate(value: unknown): number {" /%}

The renderer clamps coordinates again before it derives the grid dimensions. This second guard protects payloads that did not pass through the current CLI transform. The maximum rendered grid is therefore 64 by 64, or 4,096 cells.

{% code file="app/src/widgets/diagram.tsx" from=70 to=101 expect="const MAX_DIAGRAM_GRID_SIZE = 64;" /%}

Two smaller CLI boundaries now treat attacker-controlled strings as data:

- **frontmatter** — find a key with literal string operations. A key cannot become regular-expression source.
- **git** — place a pull-request revision after Git's `--end-of-options` marker. A leading dash cannot become a `rev-parse` option.

{% code file="src/walkthrough/frontmatter.ts" from=99 to=106 expect="/** 1-based line of a top-level frontmatter key, for file:line diagnostics. */" /%}

{% code file="src/git/git.ts" from=328 to=337 expect="/** A commit-ish resolved by a quiet probe; only git's documented exit 1 is absence. */" /%}
{% /section %}
{% /group %}

{% group label="Quality" %}
{% section id="proof" title="Regression proof" related=["highlighting", "input-boundaries"] %}
{% tests %}
{% test name="syntax-highlighting input bounds" kind="unit" ref="app/src/highlight/highlight.test.ts" asserts=["routes a 2,001-character shell line to text", "keeps unknown, CSV, and PO diff content on the custom adapter", "preserves load, registry, and render failures as typed values", "returns raw-text AST output after diff failures"] %}The tests inject failing highlighter seams and verify both the error tags and the plaintext result.{% /test %}
{% test name="oversized rendering and diagram cap" kind="unit" ref="app/src/render.test.tsx" asserts=["escapes a 6,000-character line as plaintext", "shows the English and French notices", "renders a payload coordinate of 999,999,999 on a 64-column grid"] %}Server-side rendering verifies the user-visible fallback and the renderer-side diagram guard.{% /test %}
{% test name="literal frontmatter keys" kind="unit" ref="test/frontmatter.test.ts" asserts=["reports an unbalanced-parenthesis key", "reports a backtracking-shaped key without evaluating it as a pattern"] %}Both crafted keys remain ordinary unknown-key diagnostics.{% /test %}
{% test name="leading-dash revision" kind="unit" ref="test/pr-open.test.ts" asserts=["creates a real leading-dash branch ref", "resolves it to the expected commit"] %}The fixture repository exercises the real Git process seam rather than a module mock.{% /test %}
{% /tests %}
{% /section %}
{% /group %}

{% group label="Full PR diff" %}
{% section id="files" title="Full PR diff" icon="file-diff" %}
{% files /%}
{% /section %}
{% /group %}
