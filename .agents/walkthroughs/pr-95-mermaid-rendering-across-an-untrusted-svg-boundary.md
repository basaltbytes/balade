---
walkthrough: 1
title: Mermaid rendering across an untrusted SVG boundary
pr: 95
commit: 1a1959b5f87d57c50f29e8bd679d301702fb7312
meta:
  lang: en
  area: walkthrough-rendering
  balade-authoring: 1.20.0
---

{% group label="Orientation" %}
{% section id="overview" title="Overview" %}
This change adds Mermaid diagrams as a new walkthrough block. A top-level `mermaid` fence now crosses the CLI payload contract and renders in the browser. Other fence languages remain unsupported. The important review constraint is that diagram source comes from an unreviewed pull request, while Mermaid returns SVG markup for an HTML injection sink.

The change also revises the authoring package. It encourages Mermaid for branching logic and interactions, reserves the grid diagram for relation maps, and limits `collapsed=true` to evidence below a substantial Mechanism explanation.

{% callout tone="warn" %}
The PR description names authoring package 1.12.0, but the pinned implementation and its documentation set version 1.13.0. Review this version choice as an explicit divergence from the stated release claim.
{% /callout %}
{% /section %}
{% /group %}

{% group label="Mechanism" %}
{% section id="render-pipeline" title="Compile, draw, and sanitize" %}
The compiler handles only a top-level fence whose normalized language is `mermaid`. It flushes preceding Markdown, emits the diagram at that exact block position, and then resumes Markdown collection. Nested fences, such as a fence in a blockquote, still follow the unsupported-fence path. The payload carries only a `mermaid` discriminator and the source string.

In the app, server rendering stops at a pending placeholder. The browser effect creates a selector-safe ID and loads Mermaid on first use. Mermaid initializes once with strict mode, SVG text labels, and secure configuration keys that diagram directives cannot replace. A successful render still does not go directly to React. The sink guard parses the returned markup inertly, removes scripts and event handlers, unwraps anchors, and removes non-fragment URL attributes. Only then does the widget inject the SVG. A render failure changes the state to unavailable and sends the original source through React's escaped text path.

```mermaid
flowchart TD
  fence[Mermaid fence] --> compile[Compile block]
  compile --> placeholder[SSR placeholder]
  placeholder --> render[Lazy browser render]
  render --> outcome{Render succeeds?}
  outcome -->|no| source[Escaped source]
  outcome -->|yes| guard[Sink sanitizer]
  guard --> svg[Inject SVG]
```

The compiler tests prove that the new block preserves its position. They also prove that ordinary and blockquoted fences retain the unsupported diagnostic.

The renderer disables HTML labels at each relevant Mermaid switch and protects those settings from source-level directives. It also uses a dynamic import, so served pages load the dependency only when a diagram needs it.

{% code file="app/src/mermaid/mermaid.ts" from=17 to=69 expect="const SECURE_KEYS = [" collapsed=true /%}

Strict mode is not the final trust decision. `sanitizeDiagramSvg` guards the injection seam itself and keeps only same-document URL references used by SVG markers and symbols.

{% code file="app/src/mermaid/mermaid.ts" from=71 to=121 expect="/* `target` and `ping` carry no URL of their own but only make sense on a link. */" collapsed=true /%}

The React hook owns the browser-only state transition. Empty source bypasses Mermaid, and any typed render failure becomes the unavailable state after logging.

{% code file="app/src/mermaid/use-mermaid.ts" from=28 to=51 expect="/**" collapsed=true /%}
{% /section %}
{% /group %}

{% group label="Surface" %}
{% section id="diagram-surface" title="Diagram and fallback behavior" related=["render-pipeline"] %}
A drawn diagram uses the sanitized HTML sink. Pending diagrams show a fixed placeholder. Failed or empty diagrams show the source in a `pre` element with localized chrome instead of leaving an empty section.

{% code file="app/src/widgets/mermaid.tsx" from=13 to=43 expect="export function Mermaid({ block }: { block: MermaidBlock }) {" /%}
{% /section %}

{% section id="authoring-rules" title="Authoring rules" %}
The package teaches Mermaid as an optional visual tool in a Mechanism explanation. It also places collapsed evidence in that explanation rather than making collapse the default reading state.
{% /section %}
{% /group %}

{% group label="Quality" %}
{% section id="proof" title="Boundary proof" related=["render-pipeline","diagram-surface"] %}
The tests cover the compiler, the real third-party renderer, the widget seam, and server rendering.

{% tests %}
{% test name="Fence compilation" kind="unit" ref="test/units.test.ts" asserts=["preserves prose order around a top-level Mermaid fence", "keeps non-Mermaid and blockquoted fences unsupported"] %}This verifies the new block boundary without weakening the old diagnostic.{% /test %}
{% test name="Real Mermaid security" kind="unit" ref="app/src/mermaid/mermaid.test.ts" asserts=["removes a strict-surviving anchor at the sink", "refuses a loose-security directive", "refuses directives that restore HTML labels"] %}These cases run the pinned Mermaid dependency under jsdom rather than replacing it with a module mock.{% /test %}
{% test name="Widget outcomes" kind="unit" ref="app/src/widgets/mermaid.test.tsx" asserts=["injects sanitized SVG", "keeps same-document references", "shows escaped fallback source in English and French", "skips rendering for empty source"] %}An injected renderer exercises success and failure while retaining the production sanitizer in the path.{% /test %}
{% test name="Server placeholder" kind="unit" ref="app/src/render.test.tsx" asserts=["renders the pending placeholder", "does not draw or expose source during SSR"] %}This protects the browser-only lazy-loading boundary.{% /test %}
{% /tests %}
{% /section %}
{% /group %}

{% group label="Full PR diff" %}
{% section id="files" title="Full PR diff" icon="file-diff" %}
{% files /%}
{% /section %}
{% /group %}
