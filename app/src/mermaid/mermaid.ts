/* Mermaid turns a PR-authored diagram source into SVG markup the app injects,
   which makes this module a trust boundary. The conditions that hold the sink
   safe are recorded in docs/threat-model.md, "mermaid's SVG output"; this file
   is where they are set. Mermaid itself is loaded lazily so the served app pays
   for it only on a payload that carries a diagram. */

import { Effect, Schema } from "effect";
import type { MermaidConfig } from "mermaid";

/**
 * Keys a `%%{init}%%` directive or a YAML frontmatter `config:` block inside the
 * diagram source may not overwrite. Mermaid's own defaults hold the first six;
 * `htmlLabels` and `themeCSS` are balade's additions — mermaid leaves both
 * writable from the diagram text, and the first one re-opens the HTML label
 * path this app keeps shut.
 */
const SECURE_KEYS = [
  "secure",
  "securityLevel",
  "startOnLoad",
  "maxTextSize",
  "suppressErrorRendering",
  "maxEdges",
  "htmlLabels",
  "themeCSS",
];

/**
 * The only configuration the app gives mermaid.
 *
 * `securityLevel: "strict"` makes mermaid sanitize its own output and refuse
 * `click … call` callbacks; `htmlLabels: false` keeps every label an SVG text
 * node instead of embedded HTML. The per-diagram switches are set alongside the
 * global one because a few shape renderers read `flowchart.htmlLabels` directly.
 */
export const MERMAID_CONFIG = {
  startOnLoad: false,
  securityLevel: "strict",
  htmlLabels: false,
  flowchart: { htmlLabels: false },
  class: { htmlLabels: false },
  theme: "dark",
  secure: SECURE_KEYS,
} satisfies MermaidConfig;

export class MermaidRenderFailed extends Schema.TaggedErrorClass<MermaidRenderFailed>()(
  "MermaidRenderFailed",
  { cause: Schema.Defect() },
) {}

/** The seam: a fake renderer stands in for mermaid without touching the module graph. */
export interface MermaidRenderer {
  readonly render: (id: string, source: string) => Promise<string>;
}

let loading: Promise<MermaidRenderer> | null = null;

/* One import for the whole app: mermaid keeps its configuration in module state,
   so a second instance would be a second configuration. */
const loadMermaid = (): Promise<MermaidRenderer> =>
  (loading ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize(MERMAID_CONFIG);
    return { render: async (id, source) => (await mermaid.render(id, source)).svg };
  }));

/** The production renderer: mermaid arrives as its own chunk on first use. */
export const lazyMermaidRenderer: MermaidRenderer = {
  render: async (id, source) => (await loadMermaid()).render(id, source),
};

/* `target` and `ping` carry no URL of their own but only make sense on a link. */
const URL_ATTRIBUTES = new Set([
  "href",
  "xlink:href",
  "src",
  "xlink:show",
  "target",
  "ping",
  "formaction",
]);

/** Mermaid's markers and icon symbols point at ids inside the same document. */
const isSameDocumentReference = (value: string): boolean => value.startsWith("#");

/**
 * The sink's own guard, applied to whatever the renderer returned.
 *
 * Mermaid already sanitizes its output under `securityLevel: "strict"`, but that
 * pass keeps anchors, so a `click … href` directive would put a PR-controlled
 * link on the page. Anchors are unwrapped — an SVG `<a>` positions nothing, so
 * its children draw the same either way — every off-document URL attribute and
 * event handler is dropped, and scripts go with them. `DOMParser` builds an
 * inert document: nothing in the markup runs or loads while it is inspected.
 */
export function sanitizeDiagramSvg(markup: string): string {
  const { body } = new DOMParser().parseFromString(markup, "text/html");
  for (const script of body.querySelectorAll("script")) script.remove();
  for (const anchor of body.querySelectorAll("a")) anchor.replaceWith(...anchor.childNodes);
  for (const element of body.querySelectorAll("*")) {
    for (const name of element.getAttributeNames()) {
      const lowered = name.toLowerCase();
      if (lowered.startsWith("on")) element.removeAttribute(name);
      else if (
        URL_ATTRIBUTES.has(lowered) &&
        !isSameDocumentReference(element.getAttribute(name) ?? "")
      ) {
        element.removeAttribute(name);
      }
    }
  }
  return body.innerHTML;
}

/** Injectable SVG for `source`, or a typed failure the caller turns into the source view. */
export const renderDiagram = Effect.fn("Mermaid.renderDiagram")(
  (renderer: MermaidRenderer, id: string, source: string) =>
    Effect.tryPromise({
      try: () => renderer.render(id, source),
      catch: (cause) => new MermaidRenderFailed({ cause }),
    }).pipe(Effect.map(sanitizeDiagramSvg)),
);

export const logMermaidFailure = (error: MermaidRenderFailed): Effect.Effect<void> =>
  Effect.logWarning("balade: a mermaid diagram could not be rendered; showing its source.", error);
