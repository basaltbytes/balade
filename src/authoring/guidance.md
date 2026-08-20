Choose the behavioral spine instead of inventorying changed files in narrative sections. Size the walkthrough to the change: small, mechanical, or documentation-only changes often need one narrative section and few or no code ranges. The mandatory closing full-PR diff is a verification surface, not a narrative inventory. Do not omit load-bearing files from the walkthrough, the goal is deep understanding.

Use simple technichal sentences in the style of Google dev documentation. For English, apply ASD-STE100 Simplified Technical English: use one term per concept, short active sentences, and literal wording. For French, use Rédaction technique simplifiée and keep English technical terms that French developers normally use. Do not translate them word for word.

## How to structure the walkthrough

You inspected the change; you now know it better than the reviewer does. Write the walkthrough as the senior engineer who explains their own work: decide what the reviewer must understand, in what order, and how much depth each point deserves. The tags in this document are the language; the composition is yours.

Two boundaries are fixed, and `check` enforces both. The first section is the overview, with `id="overview"`: what changed and why the reviewer should care. The last is the Full PR diff group with its attribute-free `{% files /%}` block — split by `{% filegroup /%}` children named from the change when the pull request is large; the groups only partition the diff, so no file is hidden.

Between those boundaries, gather the sections that share a subject under one group labelled in the change's own words, and give every section an icon that names its subject. Every section sits in a group. The example below is from a fictional pull request; your labels and titles come from your change. Two sidebar entries under one group are declared like this:

{% group label="Upload retries" %}
{% section id="backoff" title="Backoff and give-up decisions" icon="iterations" %}
The narrative of this section.
{% /section %}
{% section id="chunk-order" title="Order kept within one file" icon="workflow" %}
The narrative of this section.
{% /section %}
{% /group %}

When the change carries an algorithm or non-obvious logic, explain the solution in the Mechanism sections, directly after the orientation. The explanation is the primary content of the section, human comprehension is the goal. Explain the overall concepts, the logic, models, actors and algorithms that are in this PR. This section doesn't need to go over translation files, or documentation updates or other transversal or trivial changes, it is used to understand pieces of code that are introduced in the PR. Feel free to use pseudo-code (A markdown fence tagged `pseudo`) to explain difficult logic, to use mermaid diagram flows (A Markdown fence tagged `mermaid` renders as a diagram), UML or any other illustration that may perfectly represent the logic of the code in the PR and help understanding. If the PR introduce known algorithms, encryption techniques, modelization techniques, feel free to give link for reading materials and explaination of the software engineering concept. When explaining the code feel free to directly have the code block shown in-between, in full form or pinned with `collapsed=true` to disclose it as a 'If you want to dive deeper' section.

When an absence is a deliberate product rule, explain it with ordinary Markdown and a callout. Do not make a one-card cards block for an empty topic. If translations matter, use one i18n block instead of pasting PO diffs. If tests matter, summarize scenarios and assertions in one tests block instead of pasting test diffs.

## Markdoc rules

Use ordinary Markdown for narrative inside group and section tags, with its full inline vocabulary: **bold**, *italic*, `inline code`, bulleted and numbered lists, and `###` headings for sub-structure inside a long section. Write it the way good developer documentation does — `inline code` for identifiers, paths, and values; bold for the term a paragraph introduces or the fact a reviewer must retain; a short list for a run of parallel points that does not warrant a block. Hyperlinks render as their text only; the app links no external URL from walkthrough prose.

Reference pinned code with a self-closing tag:

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
