Choose the behavioral spine instead of inventorying changed files in narrative sections. A substantial walkthrough usually needs {{suggested-sections-minimum}}-{{suggested-sections-maximum}} narrative sections and {{suggested-code-ranges-minimum}}-{{suggested-code-ranges-maximum}} focused code ranges. The package has a hard maximum of {{code-ranges-maximum}} code ranges. Small, mechanical, or documentation-only changes often need one narrative section and few or no code ranges. The mandatory closing full-PR diff is a verification surface, not a narrative inventory, and does not count toward those section guidelines. Omit plumbing and unchanged context unless they carry evidence needed to review the change.

Write for a member of the public who did not read the code and did not join the coding session. Explain the named behavior before implementation detail. For English, apply ASD-STE100 Simplified Technical English: use one term per concept, short active sentences, and literal wording. For French, use Rédaction technique simplifiée and keep English technical terms that French developers normally use. Do not translate them word for word.

## Section templates

Start from this canonical navigation skeleton, adapt section ids and titles, and omit every narrative group without review signal. A changed file does not automatically deserve a narrative section. Every walkthrough ends with the Full PR diff group and its closing section containing an attribute-free `{% files /%}` block. Keep that group last; it is mandatory and does not count as inventorying the PR. That closing block may instead hold `{% filegroup /%}` children to group a large diff into collapsible thematic sections; the block itself stays attribute-free either way, and the groups only partition the changed files, so grouping never hides one.

{{section-templates}}

When the change carries an algorithm or non-obvious logic, explain the solution in the Mechanism group, directly after Orientation. The explanation is the primary content of the section, human comprehension is the goal. Explain the overall concepts, the logic, models, actors and algorithms that are in this PR. This section doesn't need to go over translation files, or documentation updates or other transversal or trivial changes, it is used to understand pieces of code that are introduced in the PR. Feel free to use plain-text, or pseudo-code to explain difficult logic, to use mermaid diagram flows (A Markdown fence tagged `mermaid` renders as a diagram), UML or any other illustration that may perfectly represent the logic of the code in the PR and help understanding. If the PR introduce known algorithms, encryption techniques, modelization techniques, feel free to give link for reading materials and explaination of the software engineering concept. When explaining the code feel free to directly have the code block shown in-between, in full form or pinned with `collapsed=true` to disclose it as a 'If you want to dive deeper' section.

When an absence is a deliberate product rule, explain it with ordinary Markdown and a callout. Do not make a one-card cards block for an empty topic. If translations matter, use one i18n block instead of pasting PO diffs. If tests matter, summarize scenarios and assertions in one tests block instead of pasting test diffs.

## Markdoc rules

Use ordinary Markdown for narrative inside group and section tags. Reference pinned code with a self-closing tag:

{% code file="src/example.ts" from=10 to=24 expect="exact first-line prefix" /%}

Read the numbered source first, keep the range focused, and copy expect exactly from the first referenced line. A code block is open by default, because the open block is the reading surface. Add collapsed=true on one kind of range only: evidence that sits directly under a substantial explanation in the Mechanism group.

{% code file="src/example.ts" from=10 to=24 expect="exact first-line prefix" collapsed=true /%}

The block then starts closed, and the reader opens it on demand. Every other range in the walkthrough stays open. Never collapse every range.

A fenced code block does not reach the payload, with one exception: a fence tagged mermaid renders as a diagram.

Markdoc attributes use double quotes. Escape every embedded double quote with a backslash, for example:

{% method sig="_check_allocation()" decorator="@api.constrains(\"allocation_id\")" %}
Explain the constraint.
{% /method %}

## Core tag catalog

Only code tags count against the range budget; every other block is free. When the content is enumerable — fields, steps, scenarios, access rules, relations — prefer the matching block over a prose list: it is denser to read and renders as a purpose-built widget. Ordinary Markdown pipe tables also render as-is.

{{tag-catalog}}

## Writing rubric

{{rubric}}
