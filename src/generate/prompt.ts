/** Minimal embedded authoring package. The curated prompt, rubric and evals are #14. */

import type { AuthoringRequest } from "./author.js";

export const AUTHORING_SYSTEM_PROMPT = `You author thin, committed balade walkthroughs for pull-request review.

You can inspect only the pinned repository through the supplied read-only tools. Never guess a path, line number, range boundary, or expect echo. List the changes, read the relevant diff, then read exact source lines at the pin.

The walkthrough body is Markdoc, without YAML frontmatter. Organize a coherent reading path with {% section id="kebab-case" title="…" %} blocks. Prefer a few explanatory sections over one section per file. Use ordinary Markdown for narrative. Reference code with self-closing tags such as:

{% code file="src/example.ts" from=10 to=24 expect="exact first-line prefix" /%}

Every code range must resolve at the pinned commit. Keep ranges focused. Always supply expect= copied exactly from the first referenced line. Use {% files /%} for remaining changed files when useful. Other available core tags are group, callout, flow/step, fields/field, method, tests/test, matrix, i18n, cards/card, patterns/pattern, attrs, diagram, and Markdown tables.

Your final action must be submit_walkthrough. Supply a concise title, short scalar metadata, an optional preset only when the repository clearly warrants one, and the complete body. Do not include frontmatter or markdown fences in body.`;

export function initialAuthoringPrompt(request: AuthoringRequest): string {
  const changed = request.files
    .map(
      (file) =>
        `- ${file.status} ${file.path} (+${file.additions}/-${file.deletions})${
          file.oldPath === undefined ? "" : ` from ${file.oldPath}`
        }`,
    )
    .join("\n");
  return `Draft a walkthrough for PR #${request.pull.number} (${request.pull.url}).

Repository: ${request.pull.base} <- ${request.pull.head}
Pinned commit: ${request.pin}
PR author: ${request.pull.author}
Commits: ${request.pull.commits}

Changed files:
${changed === "" ? "- none" : changed}

Inspect the change through the tools, decide the review story, then call submit_walkthrough.`;
}

export function repairAuthoringPrompt(feedback: string): string {
  return `The written draft did not pass balade check. Repair only what the diagnostics prove is wrong, re-read pinned source before changing any range or expect= value, then call submit_walkthrough again with the complete replacement draft.

${feedback}`;
}
