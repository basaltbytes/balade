/**
 * Odoo preset — all macros, zero custom components. `o-field` is the live one;
 * `o-security` and `o-diagram` pass their attributes to core nodes as they are.
 */

import type { Node, Schema, ValidationError } from "@markdoc/markdoc";
import { diagramBlock } from "../compile/diagram.js";
import type { Block, FieldRow, Inline } from "../payload/types.js";
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

export const odooPreset: Preset = {
  name: "odoo",
  prefix: "o-",
  tags: {
    "o-field": oField,
    "o-security": oSecurity,
    "o-diagram": oDiagram,
  },
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
