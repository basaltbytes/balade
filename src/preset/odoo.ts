/**
 * Odoo preset — all macros, zero custom components. `o-field` is the live one;
 * `o-security` and `o-diagram` pass their attributes to core nodes as they are.
 */

import type { Node, Schema, ValidationError } from "@markdoc/markdoc";
import { diagramBlock } from "../contract/diagram.js";
import type { Block, FieldRow, Inline } from "../contract/types.js";
import type { MacroApi, Preset, PresetTag } from "./types.js";

/** Relational kinds carry a comodel; `check` fails when one is missing. */
const RELATIONAL = ["Many2one", "One2many", "Many2many", "Many2oneReference"];

const DECORATOR_CHIPS: Record<string, string> = {
  "api.depends": "depends",
  "api.constrains": "constrains",
  "api.model": "model",
  "api.model_create_multi": "model",
  "api.onchange": "onchange",
};

function baseKind(kind: string): string {
  const head = kind.split("·")[0] ?? kind;
  return head.trim();
}

const fieldSchema: Schema = {
  render: "OdooField",
  attributes: {
    name: { type: String, required: true },
    kind: { type: String, required: true },
    comodel: { type: String },
    badges: { type: Array },
    tags: { type: Array },
    compute: { type: Boolean },
    readonly: { type: Boolean },
    required: { type: Boolean },
    store: { type: Boolean },
  },
  validate(node: Node): ValidationError[] {
    const kind = node.attributes["kind"];
    const comodel = node.attributes["comodel"];
    if (
      typeof kind === "string" &&
      RELATIONAL.includes(baseKind(kind)) &&
      typeof comodel !== "string"
    ) {
      return [
        {
          id: "odoo-comodel-missing",
          level: "error",
          message: `The ${baseKind(kind)} field \`${String(node.attributes["name"] ?? "")}\` needs a comodel.`,
        },
      ];
    }
    return [];
  },
};

const oField: PresetTag = {
  slot: "field",
  schema: fieldSchema,
  expand(node: Node, api: MacroApi): FieldRow[] {
    const name = String(node.attributes["name"]);
    const kind = String(node.attributes["kind"]);
    const comodel = node.attributes["comodel"];

    const badges = toStrings(node.attributes["badges"]);
    if (node.attributes["compute"] === true || /·\s*compute/.test(kind)) badges.push("computed");
    if (node.attributes["readonly"] === true) badges.push("readonly");
    if (node.attributes["required"] === true) badges.push("required");
    if (node.attributes["store"] === true) badges.push("stored");

    const tags = toStrings(node.attributes["tags"]);
    if (typeof comodel === "string") tags.unshift(`→ ${comodel}`);

    const note: Inline[] = api.inline(node);
    const row: FieldRow = {
      name,
      kind,
      note,
      ...(badges.length > 0 ? { badges: dedupe(badges) } : {}),
      ...(tags.length > 0 ? { tags } : {}),
    };
    return [row];
  },
};

const oSecurity: PresetTag = {
  slot: "block",
  schema: {
    render: "OdooSecurity",
    selfClosing: true,
    attributes: { rows: { type: Array }, model: { type: String } },
  },
  expand(node: Node): Block[] {
    const head = ["ACL · group", "read", "write", "create", "unlink"];
    const rows = Array.isArray(node.attributes["rows"])
      ? (node.attributes["rows"] as unknown[])
      : [];
    return [
      {
        b: "matrix",
        head,
        rows: rows.flatMap((row) => {
          if (row === null || typeof row !== "object") return [];
          const record = row as Record<string, unknown>;
          const cells = Array.isArray(record["cells"]) ? (record["cells"] as unknown[]) : [];
          return [
            { label: String(record["label"] ?? ""), cells: cells.map((cell) => cell === true) },
          ];
        }),
      },
    ];
  },
};

const oDiagram: PresetTag = {
  slot: "block",
  schema: {
    render: "OdooDiagram",
    selfClosing: true,
    attributes: {
      nodes: { type: Array, required: true },
      edges: { type: Array },
      intro: { type: String },
      hint: { type: String },
    },
  },
  expand: (node: Node): Block[] => [diagramBlock(node)],
};

/* Written for a model that already knows the core catalog: syntax it cannot
   guess, plus when each tag earns its place. Every attribute here is one the
   schemas above accept — a wrong spelling costs a repair turn. */
const ODOO_AUTHORING = `This is an Odoo repository. Three extra tags are active.

{% o-field %} replaces the core field tag inside a core fields block, for Odoo model fields:

{% fields %}
{% o-field name="allocation_id" kind="Many2one" comodel="planning.allocation" readonly=true %}
The source row this lens reflects.
{% /o-field %}
{% /fields %}

- name and kind are required. kind is the Odoo field type, optionally with a middle dot qualifier: "Char · compute".
- A Many2one, One2many, Many2many or Many2oneReference field needs comodel; check fails without it.
- compute, readonly, required and store are booleans that render as badges. badges and tags take arrays of short strings.
- The body is the note: say what the field means to a reviewer, not what its type already says.

{% o-security %} is self-closing and renders an ACL matrix. Pass rows explicitly; balade does not read ir.model.access.csv:

{% o-security model="planning.pool.item" rows=[{label: "base.group_user", cells: [true, false, false, false]}] /%}

Each row is one group. cells are read, write, create, unlink in that order. Use it only when the PR changes access rules.

{% o-diagram %} is self-closing and draws model relations:

{% o-diagram intro="How the pool reaches a slot." nodes=[{id: "pool", model: "planning.pool.item", change: "new", col: 1, row: 1, compartments: [{label: "fields", rows: ["allocation_id", "slot_ids"]}]}] edges=[{from: "pool", to: "slot", kind: "new", label: "One2many"}] /%}

- Each node needs id and model; change is "new", "mod" or "ctx"; col and row place it on a grid starting at 1.
- Each edge needs from and to naming node ids; kind is "new", "mod", "ctx" or "derived"; label and thick are optional.
- Use it once, for the relation the PR actually changes. A diagram of the whole module is noise.

Prefer the core tags for anything not specific to Odoo. Use an Odoo tag only where the Odoo concept is the review signal — a field's semantics, a changed ACL, a new relation.`;

export const odooPreset: Preset = {
  name: "odoo",
  prefix: "o-",
  tags: {
    "o-field": oField,
    "o-security": oSecurity,
    "o-diagram": oDiagram,
  },
  authoring: ODOO_AUTHORING,
  methodChips(decorator: string | undefined): string[] | undefined {
    if (decorator === undefined) return undefined;
    const chips: string[] = [];
    for (const [name, chip] of Object.entries(DECORATOR_CHIPS)) {
      if (decorator.includes(`@${name}`)) chips.push(chip);
    }
    return chips.length > 0 ? chips : undefined;
  },
};

function toStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
