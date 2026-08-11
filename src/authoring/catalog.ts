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

export const AUTHORING_TAG_CATALOG: readonly AuthoringTagExample[] = [
  {
    label: "section (file)",
    note: "A narrative section may present one changed file by carrying file=\"…\" — the sidebar then shows it as a color-coded file entry with the file's PR status instead of a plain title. This is a per-section judgment call: a file-section fits when one file's change is that section's whole story; a plain section fits concepts, behavior, and cross-cutting stories. Many walkthroughs need no narrative file-section, and never add one just to inventory the PR. The mandatory closing files section is the verification surface, not narrative inventory. The path must be one the PR changed. nav=\"…\" shortens any entry's sidebar label. related=[…] lists the ids of other sections this one connects to, rendered as jump chips under the heading; every id must name a section in the document.",
    example: `{% group label="Models" %}
{% section id="allocation-model" title="The allocation model" file="src/models/allocation.py" related=["allocation-proof"] %}
What this file's change does.
{% /section %}
{% section id="allocation-proof" title="Proof" file="tests/test_allocation.py" %}
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
    label: "flow/step",
    note: "One ordered control path; the optional tag names the actor or phase. A step is one short clause, never a paragraph.",
    example: `{% flow %}
{% step tag="guard" %}Reject a stale pin before any write.{% /step %}
{% step %}Apply the change.{% /step %}
{% /flow %}`,
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
    note: "Every walkthrough ends with a closing section containing a bare `{% files /%}`. That block renders the unfiltered full-PR diff browser for the reviewer's final verification sweep. A narrative section may also use a filtered listing: only matches paths, status accepts A, M, D, or R, and why annotates rows. Never put those attributes on the mandatory closing block.",
    example: `{% files only="src/**" status="A, M" why={"src/example.ts": "why it changed"} /%}`,
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
    label: "mermaid fence",
    note: "Plain Markdown, not a tag: a fenced block tagged mermaid renders as a diagram. It earns its place when a picture makes branching logic or an interaction clearer than prose alone, most often inside the Mechanism explanation. Choose the type that fits the logic: a flowchart for branches, a sequence diagram for interactions between parts. Keep every node label to a few words; a sentence inside a node defeats the diagram. A diagram is never required.",
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
    note: 'A relation map between named parts the change touches: models, components, or services. Only this block carries a per-part change status and a section reference, so it shows what a mermaid diagram cannot. A node needs id and model; change is "new", "mod" or "ctx"; col and row place it on a grid that starts at 1; ref points the node at a section id; compartments hold labelled member rows. An edge joins two node ids; kind is "new", "mod", "ctx" or "derived"; label and thick are optional — mark the one relation the change turns on with thick=true. Use it when the change adds or rewires a relation between named parts, and leave out parts the change never touches. Never use it for a sequence of steps or for branching logic: a flow block or a mermaid fence carries those. A node label is a name, never a sentence. Most walkthroughs need no grid diagram.',
    example: `{% diagram intro="How a slot reaches its pool." nodes=[{id: "pool", model: "planning.pool", change: "new", col: 1, row: 1, compartments: [{label: "fields", rows: ["slot_ids"]}]}, {id: "slot", model: "planning.slot", change: "mod", col: 2, row: 1}] edges=[{from: "pool", to: "slot", kind: "new", label: "One2many", thick: true}] /%}`,
  },
];

/** The catalog as one prompt or skill fragment. */
export const tagCatalogText = AUTHORING_TAG_CATALOG.map(
  ({ label, note, example }) => `${label} — ${note}
${example}`,
).join("\n\n");
