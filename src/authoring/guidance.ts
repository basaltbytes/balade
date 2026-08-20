/**
 * The prose the Pi prompt and the generated skill share verbatim, as one
 * document that reads top to bottom: `guidance.md` beside this module. Both
 * renderings interpolate it whole — edit once, and neither surface can drift
 * from the other. Only the section headings differ between the two hosts:
 * the document's `##` headings render as-is in the skill and as bare titles
 * in the Pi prompt. Rendering-specific prose (the Pi tool contract, the
 * skill's authoring loop) stays in each renderer.
 */

import { tagCatalogText } from "./catalog.js";
import { plainHeadings, proseTemplate, renderProse } from "./prose.js";
import { rubricText } from "./rubric.js";
import { exemplarsText } from "./exemplars.js";

/** How a host surface renders the document's `##` section headings. */
export type GuidanceHeadings = "markdown" | "plain";

/** The shared authoring course, rendered for one host surface. */
export function sharedGuidance(headings: GuidanceHeadings): string {
  const template = proseTemplate(import.meta.url, "guidance.md");
  /* Both hosts embed the guidance mid-document, so the file's trailing newline is trimmed. */
  return renderProse(headings === "plain" ? plainHeadings(template) : template, {
    exemplars: exemplarsText,
    "tag-catalog": tagCatalogText,
    rubric: rubricText,
  }).trimEnd();
}
