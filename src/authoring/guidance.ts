/**
 * Prose the Pi prompt and the generated skill share verbatim. One fragment
 * here is one paragraph both renderings interpolate — edit once, and neither
 * surface can drift from the other. Rendering-specific prose (the Pi tool
 * contract, the skill's authoring loop) stays in each renderer.
 */

import { AUTHORING_LIMITS } from "./package.js";

/** Section economy: follow the change's spine, not its file list. */
export const spineText = `Choose the behavioral spine instead of inventorying changed files in narrative sections. A substantial walkthrough usually needs ${AUTHORING_LIMITS.suggestedSections.minimum}-${AUTHORING_LIMITS.suggestedSections.maximum} narrative sections and ${AUTHORING_LIMITS.suggestedCodeRanges.minimum}-${AUTHORING_LIMITS.suggestedCodeRanges.maximum} focused code ranges. The package has a hard maximum of ${AUTHORING_LIMITS.codeRanges} code ranges. Small, mechanical, or documentation-only changes often need one narrative section and few or no code ranges. The mandatory closing full-PR diff is a verification surface, not a narrative inventory, and does not count toward those section guidelines. Omit plumbing and unchanged context unless they carry evidence needed to review the change.`;

/** Who the walkthrough is for, and the writing standard per language. */
export const audienceText =
  "Write for a member of the public who did not read the code and did not join the coding session. Explain the named behavior before implementation detail. For English, apply ASD-STE100 Simplified Technical English: use one term per concept, short active sentences, and literal wording. For French, use Rédaction technique simplifiée and keep English technical terms that French developers normally use. Do not translate them word for word.";

/** The two-layer comprehension pattern: explanation first, evidence under it. */
export const algorithmText =
  "When the change carries an algorithm or non-obvious logic, explain the solution in the Mechanism group, directly after Orientation. The explanation is the primary content of the section, human comprehension is the goal. Explain the overall concepts, the logic, models, actors and algorithms that are in this PR. This section doesn't need to go over translation files, or documentation updates or other transversal or trivial changes, it is used to understand pieces of code that are introduced in the PR. Feel free to use plain-text, or pseudo-code to explain difficult logic, to use mermaid diagram flows (A Markdown fence tagged `mermaid` renders as a diagram), UML or any other illustration that may perfectly represent the logic of the code in the PR and help understanding. If the PR introduces known algorithms, encryption techniques, modelization techniques, feel free to give link for reading materials and explanation of the software engineering concept. When explaining the code feel free to directly have the code block shown in-between, in full form or pinned with `collapsed=true` to disclose it as a 'If you want to dive deeper' section.";
/** How to hold the section-template skeleton. */
export const templatesLeadText =
  "Start from this canonical navigation skeleton, adapt section ids and titles, and omit every narrative group without review signal. A changed file does not automatically deserve a narrative section. Every walkthrough ends with the Full PR diff group and its closing section containing an attribute-free `{% files /%}` block. Keep that group last; it is mandatory and does not count as inventorying the PR.";

/** Deliberate absences and the blocks that replace pasted diffs. */
export const absenceText =
  "When an absence is a deliberate product rule, explain it with ordinary Markdown and a callout. Do not make a one-card cards block for an empty topic. If translations matter, use one i18n block instead of pasting PO diffs. If tests matter, summarize scenarios and assertions in one tests block instead of pasting test diffs.";

/** The code tag, the quote rule, and the escaping example. */
export const markdocRulesText = `Use ordinary Markdown for narrative inside group and section tags. Reference pinned code with a self-closing tag:

{% code file="src/example.ts" from=10 to=24 expect="exact first-line prefix" /%}

Read the numbered source first, keep the range focused, and copy expect exactly from the first referenced line. A code block is open by default, because the open block is the reading surface. Add collapsed=true on one kind of range only: evidence that sits directly under a substantial explanation in the Mechanism group.

{% code file="src/example.ts" from=10 to=24 expect="exact first-line prefix" collapsed=true /%}

The block then starts closed, and the reader opens it on demand. Every other range in the walkthrough stays open. Never collapse every range.

A fenced code block does not reach the payload, with one exception: a fence tagged mermaid renders as a diagram.

Markdoc attributes use double quotes. Escape every embedded double quote with a backslash, for example:

{% method sig="_check_allocation()" decorator="@api.constrains(\\"allocation_id\\")" %}
Explain the constraint.
{% /method %}`;

/** The cost model that makes structured blocks worth choosing over prose. */
export const catalogLeadText =
  "Only code tags count against the range budget; every other block is free. When the content is enumerable — fields, steps, scenarios, access rules, relations — prefer the matching block over a prose list: it is denser to read and renders as a purpose-built widget. Ordinary Markdown pipe tables also render as-is.";
