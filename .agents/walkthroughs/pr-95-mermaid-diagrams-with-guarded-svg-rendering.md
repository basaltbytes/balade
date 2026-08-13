---
walkthrough: 1
title: Mermaid diagrams with guarded SVG rendering
pr: 95
commit: 1a1959b5f87d57c50f29e8bd679d301702fb7312
meta:
  pr: "95"
  commit: db0f96c
  scope: renderer and authoring
  balade-authoring: 1.15.0
---

{% group label="Orientation" %}
{% section id="overview" title="Overview" %}
This change lets a walkthrough use a top-level Markdown fence tagged `mermaid`. The compiler keeps the diagram at its position between prose blocks and adds a `mermaid` variant to the payload contract. Other fenced code still produces the existing unsupported-fence warning.

The main review constraint is trust. Diagram source comes from the pull request. Mermaid converts it to SVG, and the app injects that SVG into the page. The implementation therefore limits Mermaid configuration and sanitizes the returned SVG at the injection boundary. It also updates the authoring package: Mermaid is for control flow or interactions, while collapsed code evidence is limited to substantial Mechanism explanations.
{% /section %}
{% /group %}

{% group label="Mechanism" %}
{% section id="render-pipeline" title="Compile and render pipeline" %}
The compiler recognizes only a top-level fence whose normalized language is `mermaid`. It flushes the prose before the fence, emits one diagram block, and then resumes prose compilation. This preserves the authored order. A nested or differently tagged fence remains in Markdown flow and receives the unsupported-fence diagnostic.

```mermaid
flowchart LR
  fence[Mermaid fence] --> block[Payload block]
  block --> browser[Browser effect]
  browser --> render[Mermaid render]
  render --> guard[SVG guard]
  guard --> view[Diagram view]
  render -->|failure| source[Escaped source]
```

The payload contract carries the untrusted source in an explicit `mermaid` block variant that both the CLI and app must handle.

The browser loads Mermaid on first use. Its fixed configuration uses strict mode, disables HTML labels at each relevant switch, and protects those switches from diagram-level directives. After rendering, the sink guard removes scripts and anchors. It also removes event handlers and non-fragment URL attributes, while preserving same-document SVG references.

{% code file="app/src/mermaid/mermaid.ts" from=17 to=44 expect="const SECURE_KEYS = [" collapsed=true /%}

{% code file="app/src/mermaid/mermaid.ts" from=71 to=120 expect="/* `target` and `ping` carry no URL of their own but only make sense on a link. */" collapsed=true /%}
{% /section %}
{% /group %}

{% group label="Surface" %}
{% section id="diagram-states" title="Diagram states" %}
The widget has three visible states. Server rendering and the first browser render show a pending placeholder. A successful render injects only the guarded SVG. Empty source or a render failure shows the original source as escaped text with a localized note.

{% code file="app/src/widgets/mermaid.tsx" from=13 to=44 expect="export function Mermaid({ block }: { block: MermaidBlock }) {" /%}

The browser effect does not call Mermaid for empty source. Each non-empty diagram receives an app-generated, selector-safe id before rendering.

{% code file="app/src/mermaid/use-mermaid.ts" from=14 to=49 expect="export type Diagram =" /%}

The authoring guidance now keeps collapsed code ranges exceptional. Authors can collapse evidence only below a substantial explanation in the Mechanism group. Other code ranges stay open. Mermaid fences are suggested when a flowchart or interaction diagram explains logic better than prose; the existing grid `diagram` block remains for relation maps with change status and section references.
{% /section %}
{% /group %}

{% group label="Quality" %}
{% section id="security-proof" title="Security and fallback proof" %}
The tests cover both the compiler seam and the browser sink. The real-Mermaid tests are important because they first prove that strict mode still returns an anchor, then prove that the sink guard removes it.

{% tests %}
{% test name="preserves fence position" kind="unit" ref="test/units.test.ts" asserts=["keeps prose before and after the diagram in order", "keeps non-Mermaid fences unsupported", "keeps blockquoted Mermaid fences unsupported"] %}The compiler tests distinguish the new top-level exception from existing fenced-code behavior.{% /test %}
{% test name="guards real Mermaid output" kind="unit" ref="app/src/mermaid/mermaid.test.ts" asserts=["removes a strict-mode anchor and its external URL", "refuses a directive that requests loose security", "refuses a directive that restores HTML labels"] %}These tests send adversarial source through the installed Mermaid renderer before applying the app guard.{% /test %}
{% test name="renders safe widget states" kind="unit" ref="app/src/widgets/mermaid.test.tsx" asserts=["injects successful SVG", "removes scripts, links, handlers, and external references", "preserves fragment references", "shows escaped fallback source in English and French", "skips rendering for empty source"] %}The widget tests cover the final injection seam and the user-visible failure path.{% /test %}
{% /tests %}
{% /section %}
{% /group %}

{% group label="Full PR diff" %}
{% section id="files" title="Full PR diff" icon="file-diff" %}
{% files /%}
{% /section %}
{% /group %}
