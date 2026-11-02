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
  "dompurifyConfig",
  "fontFamily",
  "altFontFamily",
  "themeVariables",
  "look",
  "layout",
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
  suppressErrorRendering: true,
  dompurifyConfig: {
    FORBID_TAGS: ["img", "image", "style", "iframe", "object", "embed", "video", "audio", "source"],
  },
  secure: SECURE_KEYS,
} satisfies MermaidConfig;

export class MermaidRenderFailed extends Schema.TaggedErrorClass<MermaidRenderFailed>()(
  "MermaidRenderFailed",
  { cause: Schema.Defect() },
) {}

/** The seam: a fake renderer stands in for mermaid without touching the module graph. */
export interface MermaidRenderer {
  readonly render: (id: string, source: string, container: HTMLElement) => Promise<string>;
}

let loading: Promise<MermaidRenderer> | null = null;

/* One import for the whole app: mermaid keeps its configuration in module state,
   so a second instance would be a second configuration. */
const loadMermaid = (): Promise<MermaidRenderer> =>
  (loading ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize(MERMAID_CONFIG);
    return {
      render: async (id, source, container) => {
        try {
          return (await mermaid.render(id, source, container)).svg;
        } finally {
          container.replaceChildren();
        }
      },
    };
  }));

/** The production renderer: mermaid arrives as its own chunk on first use. */
export const lazyMermaidRenderer: MermaidRenderer = {
  render: async (id, source, container) => (await loadMermaid()).render(id, source, container),
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
export function sanitizeDiagramSvg(markup: string, namespace: string): string {
  const { body } = new DOMParser().parseFromString(markup, "text/html");
  for (const script of body.querySelectorAll(
    "script, foreignObject, image, img, iframe, object, embed, video, audio, source, animate, set",
  ))
    script.remove();
  for (const anchor of body.querySelectorAll("a")) anchor.replaceWith(...anchor.childNodes);
  const ids = new Map(
    [...body.querySelectorAll("[id]")].map((element, index) => [
      element.id,
      `${namespace}-${index}`,
    ]),
  );
  const rootId = body.querySelector("svg")?.id;
  for (const element of body.querySelectorAll("*")) {
    if (element.id) element.id = ids.get(element.id) ?? element.id;
    for (const name of element.getAttributeNames()) {
      const lowered = name.toLowerCase();
      const value = element.getAttribute(name) ?? "";
      if (lowered.startsWith("on")) {
        element.removeAttribute(name);
        continue;
      }
      if (URL_ATTRIBUTES.has(lowered)) {
        const linked = value.startsWith("#") ? ids.get(value.slice(1)) : undefined;
        if (linked === undefined) element.removeAttribute(name);
        else element.setAttribute(name, `#${linked}`);
        continue;
      }
      if (name === "aria-labelledby" || name === "aria-describedby") {
        element.setAttribute(
          name,
          value
            .split(/\s+/)
            .flatMap((id) => ids.get(id) ?? [])
            .join(" "),
        );
        continue;
      }
      element.setAttribute(name, localUrls(value, ids));
    }
    if (element.tagName.toLowerCase() === "style") {
      let css = localUrls(element.textContent ?? "", ids);
      if (rootId) css = css.replaceAll(`#${rootId}`, `#${ids.get(rootId)}`);
      element.textContent = css;
    }
  }
  return body.innerHTML;
}

function localUrls(value: string, ids: ReadonlyMap<string, string>): string {
  return value.replace(/url\(\s*["']?([^)'"\s]*)["']?\s*\)/gi, (_match, reference: string) => {
    const target = reference.startsWith("#") ? ids.get(reference.slice(1)) : undefined;
    return target === undefined ? "none" : `url(#${target})`;
  });
}

/** Injectable SVG for `source`, or a typed failure the caller turns into the source view. */
export const renderDiagram = Effect.fn("Mermaid.renderDiagram")(
  (renderer: MermaidRenderer, id: string, source: string, container: HTMLElement) =>
    Effect.tryPromise({
      try: () => {
        // Mermaid can fetch images while measuring, before returning its sanitized SVG.
        // Resource syntax, HTML, CSS escapes/entities and CSS URLs are outside this text-only renderer.
        if (source.length > 50_000)
          return Promise.reject(new Error("Diagram exceeds the rendering limit"));
        if (
          /[\\]|\/\*|&(?:#|[a-z]+;)|<\s*[a-z!/]|!\[|\b(?:img|image)["']?\s*:|\bshape["']?\s*:\s*["']?image|(?:url|var|attr|image-set|paint)\s*\(|@(?:import|font-face)/i.test(
            source,
          )
        ) {
          return Promise.reject(new Error("Diagram resource syntax is not supported"));
        }
        return renderer.render(id, source, container);
      },
      catch: (cause) => new MermaidRenderFailed({ cause }),
    }).pipe(Effect.map((svg) => sanitizeDiagramSvg(svg, id))),
);

export const logMermaidFailure = (error: MermaidRenderFailed): Effect.Effect<void> =>
  Effect.logWarning("balade: a mermaid diagram could not be rendered; showing its source.", error);
