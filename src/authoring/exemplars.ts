/**
 * Two complete exemplar walkthroughs, taught before any rule. The model
 * imitates the artifact it is shown, so every structural convention appears
 * here correct instead of being legislated in prose: the overview opens,
 * every section sits in a labelled group and carries an icon, evidence sits
 * under its claim, the bare full-PR diff closes. Each exemplar lives as a
 * Markdown document beside this module — a one-line pull-request context,
 * then the walkthrough body — so editing one is editing a document, not a
 * template literal. Tests parse both against the real Markdoc config and pin
 * that structure.
 */

import { proseTemplate } from "./prose.js";

export interface AuthoringExemplar {
  /** Which pull-request shape the exemplar answers. */
  readonly name: "feature" | "documentation";
  /** The document: a one-line context, a blank line, and the walkthrough body. */
  readonly text: string;
}

const exemplar = (name: AuthoringExemplar["name"]): AuthoringExemplar => ({
  name,
  text: proseTemplate(import.meta.url, `exemplar-${name}.md`).trimEnd(),
});

export const AUTHORING_EXEMPLARS: readonly AuthoringExemplar[] = [
  exemplar("feature"),
  exemplar("documentation"),
];

/** The exemplars as one prompt or skill fragment. */
export const exemplarsText = AUTHORING_EXEMPLARS.map(({ text }) => text).join("\n\n");
