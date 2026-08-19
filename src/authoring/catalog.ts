/**
 * The core tag catalog: one taught example per block family. Tests parse every
 * example against the real Markdoc config, so the catalog cannot drift from
 * the format.
 */

export interface AuthoringTagExample {
  /** The tag family taught, e.g. "fields/field". */
  readonly label: string;
  /** When the block earns its place, plus the attribute rules the example cannot show. */
  readonly note: string;
  /** A complete use, valid against the real Markdoc config — tests parse every entry. */
  readonly example: string;
}

/**
 * The icon vocabulary, grouped by the subject each name states. The groups are
 * what the catalog teaches: a flat list of names makes the model match an icon
 * to a template position instead of to the section's subject. The renderer maps
 * every name here, plus the chrome and file-status glyphs an author never
 * writes; a test holds this list inside the renderer's map.
 */
export const AUTHORING_ICON_GROUPS: readonly {
  readonly subject: string;
  readonly names: readonly string[];
}[] = [
  {
    subject: "behavior and interfaces",
    names: ["browser", "terminal", "server", "cloud", "globe", "code-square"],
  },
  {
    subject: "data and state",
    names: ["database", "stack", "table", "versions", "list-unordered"],
  },
  {
    subject: "flow and history",
    names: [
      "workflow",
      "iterations",
      "sync",
      "git-branch",
      "git-merge",
      "git-compare",
      "git-commit",
      "git-pull-request",
      "history",
    ],
  },
  {
    subject: "logic and performance",
    names: ["gear", "graph", "cpu", "meter", "stopwatch"],
  },
  {
    subject: "security and rules",
    names: ["shield-lock", "shield-check", "key", "lock", "law"],
  },
  {
    subject: "tests and defects",
    names: ["beaker", "checklist", "bug", "codescan"],
  },
  {
    subject: "documentation and copy",
    names: ["book", "note", "pencil", "typography", "comment-discussion"],
  },
  {
    subject: "interface design",
    names: ["paintbrush", "image", "device-mobile", "accessibility"],
  },
  {
    subject: "agents and people",
    names: ["agent", "ai-model", "person", "people", "organization"],
  },
  {
    subject: "packaging and release",
    names: ["package", "tag", "milestone", "dependabot", "container"],
  },
  {
    subject: "files",
    names: ["file", "file-code", "file-binary", "file-diff"],
  },
  {
    subject: "notices and questions",
    names: ["alert", "info", "light-bulb", "question", "issue-opened"],
  },
  {
    subject: "configuration and search",
    names: ["sliders", "tools", "log", "filter", "search", "link", "repo", "clock"],
  },
];

export const AUTHORING_ICON_NAMES: readonly string[] = AUTHORING_ICON_GROUPS.flatMap(
  (group) => group.names,
);

/** The vocabulary as one prompt fragment: one subject per line. */
const iconVocabulary = AUTHORING_ICON_GROUPS.map(
  ({ subject, names }) => `${subject}: ${names.join(", ")}`,
).join("; ");

export const AUTHORING_TAG_CATALOG: readonly AuthoringTagExample[] = [
  {
    label: "section",
    note: `A narrative section may present one changed file by carrying file="…" — the sidebar then shows it as a color-coded file entry with the file's PR status instead of a plain title. This is a per-section judgment call: a file-section fits when one file's change is that section's whole story; a plain section fits concepts, behavior, and cross-cutting stories. Many walkthroughs need no narrative file-section, and never add one just to inventory the PR. The mandatory closing files section is the verification surface, not narrative inventory. The path must be one the PR changed. nav="…" shortens any entry's sidebar label. related=[…] lists the ids of other sections this one connects to, rendered as jump chips under the heading; every id must name a section in the document. icon="…" sets the section glyph in the sidebar and in the section head. Set an icon on every section, and pick the name that states that section's subject. Do not reuse the icon of the template you started from. A missing or unknown name renders a neutral dot. A file-section shows its file status in the sidebar, so there the icon applies to the section head only. The names, by subject — ${iconVocabulary}. badge="…" adds a chip beside the section title, and badgeTone is "new", "mod" or "del". Without badgeTone, a file-section takes the tone of its file status and a plain section takes "mod". Add a badge only when the section carries a status the reader must see.`,
    example: `{% group label="Allocation" %}
{% section id="allocation-model" title="The allocation model" icon="database" file="src/models/allocation.py" related=["allocation-proof"] %}
What this file's change does.
{% /section %}
{% section id="allocation-proof" title="Proof" icon="beaker" file="tests/test_allocation.py" %}
The regression evidence.
{% /section %}
{% /group %}`,
  },
  {
    label: "callout",
    note: 'tone is "key" or "warn"; omit it for a neutral aside.',
    example: `{% callout tone="key" %}
One sentence the reviewer must not miss.
{% /callout %}`,
  },
  {
    label: "fields/field",
    note: "A name/kind/note table for fields, props, state, columns, or options.",
    example: `{% fields %}
{% field name="total" kind="number" badges=["computed"] %}What the field means to a reviewer.{% /field %}
{% /fields %}`,
  },
  {
    label: "method",
    note: "decorator and chips are optional; the decorator renders as chips beside the signature.",
    example: `{% method sig="apply(change)" decorator="@memo" %}
What it does and when it runs.
{% /method %}`,
  },
  {
    label: "tests/test",
    note: 'kind is "unit", "tour" or "http". Read the tests, then summarize; never paste test diffs.',
    example: `{% tests %}
{% test name="test_expiry" kind="unit" ref="tests/test_expiry.py" asserts=["rejects a past date", "keeps the open slot"] %}One- or two-sentence scenario.{% /test %}
{% /tests %}`,
  },
  {
    label: "matrix",
    note: "The first column is the row label; a cell holding ✓ renders as granted, anything else as denied. Use it for permission or capability grids.",
    example: `{% matrix %}
| Group | read | write |
| --- | --- | --- |
| base.group_user | ✓ | — |
{% /matrix %}`,
  },
  {
    label: "files",
    note: "Every walkthrough ends with a closing section containing a bare `{% files /%}`. That block renders the unfiltered full-PR diff browser for the reviewer's final verification sweep. A narrative section may also use a filtered listing: only matches paths, status accepts A, M, D, or R, and why annotates rows. Never put those attributes on the mandatory closing block. The block can instead take `{% filegroup /%}` children, which split that same browser into collapsible thematic sections: label names the section and is required, only accepts `*` within one path segment, `**` across directories, `?` for one character, and `{a,b}` alternatives whose entries may each be a complete path pattern; status takes a comma list of A, M, D or R. Prefer one tag with brace alternatives when a group spans several patterns. If sibling tags repeat the exact label, their claimed paths coalesce under one group at the label's first position. Each tag still claims, in authored order, the changed files its filter matches among the files no earlier tag already claimed, so a file lands in exactly one group. A filegroup with no filter claims everything still unclaimed, which makes it a useful last group. Files that no group claims still render, ungrouped, after the groups: grouping partitions the diff and can never hide a file, so the closing block stays a complete verification surface. Grouping earns its place as soon as the pull request touches more than ten files — group the closing block then, and choose the labels from what the change actually contains, for example Tests, Traductions, Models, Security, UI, Controllers, or Misc.",
    example: `{% files only="src/**" status="A, M" why={"src/example.ts": "why it changed"} /%}

{% files %}
{% filegroup label="Agent and CLI" only="{src/agent/**,src/commands/**,src/cli.ts}" /%}
{% filegroup label="Tests" only="{test/**,app/**/*.test.tsx}" /%}
{% filegroup label="UI" only="app/**" /%}
{% filegroup label="Misc" /%}
{% /files %}`,
  },
  {
    label: "i18n",
    note: "One row per changed .po or .pot file with entry counts, computed from the PR.",
    example: `{% i18n /%}`,
  },
  {
    label: "cards/card",
    note: "Two to four parallel points; cols is 1, 2 or 3.",
    example: `{% cards cols=2 %}
{% card icon="beaker" title="Trade-off" %}Body.{% /card %}
{% card title="Alternative" %}Body.{% /card %}
{% /cards %}`,
  },
  {
    label: "patterns/pattern",
    note: "A small glossary of repository idioms the reader needs.",
    example: `{% patterns %}
{% pattern term="lens" ref="src/lens.ts" %}Definition.{% /pattern %}
{% /patterns %}`,
  },
  {
    label: "attrs",
    note: "A bare chip list.",
    example: `{% attrs items=["readonly", "cascade"] /%}`,
  },
  {
    label: "pseudo fence",
    note: "Plain Markdown, not a tag: a fenced block tagged pseudo renders as plain pseudo-code. Use it in the Mechanism explanation for the logic of one algorithm: condition/action lines for a decision path, an indented call tree for runtime flow. Pick the smallest view that clarifies the key point. Keep each line to a few words; include only the essential calls, decisions and boundaries. Interactions between parts belong in a mermaid fence; real code belongs in code ranges, as evidence.",
    example: `\`\`\`pseudo
on upload(file)
  if size over quota
    reject with quota error
  store the file
  queue a thumbnail job
\`\`\`

\`\`\`pseudo
publishDraft
  validateFrontmatter
    checkCommitReachable
  writePayload
  notifyReviewers
\`\`\``,
  },
  {
    label: "mermaid fence",
    note: "Plain Markdown, not a tag: a fenced block tagged mermaid renders as a diagram. It is the tool for showing an interaction between parts or branching logic, most often inside the Mechanism explanation; the straight-line logic of one algorithm reads better as a pseudo fence. Choose the type that fits the logic: a flowchart for an ordered path or branches, a sequence diagram for interactions between parts. Keep every node label to a few words; a sentence inside a node defeats the diagram.",
    example: `\`\`\`mermaid
flowchart TD
  req[Request] --> status{Retryable status?}
  status -->|no| fail[Return the error]
  status -->|yes| budget{Attempts left?}
  budget -->|no| fail
  budget -->|yes| retry[Wait, then retry]
\`\`\``,
  },
  {
    label: "diagram",
    note: 'A relation map between named parts the change touches: models, components, or services. Only this block carries a per-part change status and a section reference, so it shows what a mermaid diagram cannot. A node needs id and model; change is "new", "mod" or "ctx"; col and row place it on a grid that starts at 1; ref points the node at a section id; compartments hold labelled member rows. An edge joins two node ids; kind is "new", "mod", "ctx" or "derived"; label and thick are optional — mark the one relation the change turns on with thick=true. Use it when the change adds or rewires a relation between named parts, and leave out parts the change never touches. Never use it for a sequence of steps or for branching logic: a mermaid fence carries those. A node label is a name, never a sentence. Most walkthroughs need no grid diagram.',
    example: `{% diagram intro="How a slot reaches its pool." nodes=[{id: "pool", model: "planning.pool", change: "new", col: 1, row: 1, compartments: [{label: "fields", rows: ["slot_ids"]}]}, {id: "slot", model: "planning.slot", change: "mod", col: 2, row: 1}] edges=[{from: "pool", to: "slot", kind: "new", label: "One2many", thick: true}] /%}`,
  },
];

/** The catalog as one prompt or skill fragment. */
export const tagCatalogText = AUTHORING_TAG_CATALOG.map(
  ({ label, note, example }) => `${label} — ${note}
${example}`,
).join("\n\n");
