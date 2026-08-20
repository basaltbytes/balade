Choose the behavioral spine instead of inventorying changed files in narrative sections. Size the walkthrough to the change: small, mechanical, or documentation-only changes often need one narrative section and few or no code ranges. The mandatory closing full-PR diff is a verification surface, not a narrative inventory. Do not omit load-bearing files from the walkthrough, the goal is deep understanding.

Use simple technichal sentences in the style of Google dev documentation. For English, apply ASD-STE100 Simplified Technical English: use one term per concept, short active sentences, and literal wording. For French, use Rédaction technique simplifiée and keep English technical terms that French developers normally use. Do not translate them word for word.

## How to structure the walkthrough

Work through these steps once per pull request:

1. Read the diff. Write one sentence: what changed and why a reviewer should care. That sentence opens the overview — the first section, with `id="overview"`. `check` rejects a walkthrough that opens with any other section.
2. List the subjects a reviewer must understand to approve the change. Candidate subjects: the algorithm or non-obvious logic; the domain types, state, or services whose structure carries the change; the behavior a caller, operator, or user can observe; the evidence — tests, security, migrations, translations. Most changes carry one to three subjects beyond the overview. A mechanical or documentation-only change may carry none.
3. Give each subject one group, labelled in the change's own words, and write its sections. Every section sits in a group and carries an icon that names its subject. Explanation comes first; the code range that proves a claim sits directly under that claim.
4. Close with the Full PR diff group and its attribute-free `{% files /%}` block. `check` rejects a walkthrough without it. When the pull request touches more than ten files, split that closing browser with `{% filegroup /%}` children named from the change; the groups only partition the diff, so no file is hidden.

## Exemplars

{{exemplars}}

When the change carries an algorithm or non-obvious logic, explain the solution in the Mechanism sections, directly after the orientation. The explanation is the primary content of the section, human comprehension is the goal. Explain the overall concepts, the logic, models, actors and algorithms that are in this PR. This section doesn't need to go over translation files, or documentation updates or other transversal or trivial changes, it is used to understand pieces of code that are introduced in the PR. Feel free to use pseudo-code (A markdown fence tagged `pseudo`) to explain difficult logic, to use mermaid diagram flows (A Markdown fence tagged `mermaid` renders as a diagram), UML or any other illustration that may perfectly represent the logic of the code in the PR and help understanding. If the PR introduce known algorithms, encryption techniques, modelization techniques, feel free to give link for reading materials and explaination of the software engineering concept. When explaining the code feel free to directly have the code block shown in-between, in full form or pinned with `collapsed=true` to disclose it as a 'If you want to dive deeper' section.

When an absence is a deliberate product rule, explain it with ordinary Markdown and a callout. Do not make a one-card cards block for an empty topic. If translations matter, use one i18n block instead of pasting PO diffs. If tests matter, summarize scenarios and assertions in one tests block instead of pasting test diffs.

## Markdoc rules

Use ordinary Markdown for narrative inside group and section tags. Reference pinned code with a self-closing tag:

{% code file="src/example.ts" from=10 to=24 expect="exact first-line prefix" /%}

Read the numbered source first, keep the range focused, and copy expect exactly from the first referenced line. A code block is open by default, because the open block is the reading surface. Add collapsed=true on one kind of range only: evidence that sits directly under a substantial explanation in a Mechanism section.

{% code file="src/example.ts" from=10 to=24 expect="exact first-line prefix" collapsed=true /%}

The block then starts closed, and the reader opens it on demand. Every other range in the walkthrough stays open. Never collapse every range.

Top level fences render as read-only text, mermaid renders as a diagram, nested fences are dropped.

Markdoc attributes use double quotes. Escape every embedded double quote with a backslash, for example:

{% method sig="_check_allocation()" decorator="@api.constrains(\"allocation_id\")" %}
Explain the constraint.
{% /method %}

## Core tag catalog

Only code tags count against the range budget; every other block is free. When the content is enumerable — fields, steps, scenarios, access rules, relations — prefer the matching block over a prose list: it is denser to read and renders as a purpose-built widget. Ordinary Markdown pipe tables also render as-is.

{{tag-catalog}}

## Writing rubric

{{rubric}}
