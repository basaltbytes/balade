/**
 * The 15-tag core catalog. Attributes hold plain data only — strings,
 * numbers, enums, arrays, maps. Rich text lives in tag bodies.
 */

import Markdoc from "@markdoc/markdoc";
import type { Node, Schema, SchemaAttribute, ValidationError } from "@markdoc/markdoc";

export const SECTION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const FILE_STATUSES = ["A", "M", "D", "R"] as const;

/** `status="A, M"` → `["A", "M"]` — the one spelling of the comma list. */
export function statusList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}
const CODE_VIEWS = ["plain", "change", "diff"] as const;

/** Tag names that hold a child family; the compiler checks the child names. */
export const CHILD_TAGS: Record<string, readonly string[]> = {
  flow: ["step"],
  fields: ["field"],
  tests: ["test"],
  cards: ["card"],
  patterns: ["pattern"],
  files: ["filegroup"],
};

function rangeErrors(node: Node): ValidationError[] {
  const from = node.attributes["from"] as unknown;
  const to = node.attributes["to"] as unknown;
  if (typeof from !== "number" || typeof to !== "number") return [];
  if (from < 1) {
    return [
      { id: "code-range-invalid", level: "error", message: `from (${from}) must be 1 or more.` },
    ];
  }
  if (from > to) {
    return [
      {
        id: "code-range-invalid",
        level: "error",
        message: `from (${from}) must be less than or equal to to (${to}).`,
      },
    ];
  }
  return [];
}

const section: Schema = {
  render: "Section",
  attributes: {
    id: { type: String, required: true, matches: SECTION_ID },
    title: { type: String, required: true },
    nav: { type: String },
    icon: { type: String },
    file: { type: String },
    badge: { type: String },
    badgeTone: { type: String, matches: ["new", "mod", "del"] },
    related: { type: Array },
  },
};

const group: Schema = {
  render: "Group",
  attributes: { label: { type: String, required: true } },
};

const code: Schema = {
  render: "Code",
  selfClosing: true,
  attributes: {
    file: { type: String, required: true },
    from: { type: Number, required: true },
    to: { type: Number, required: true },
    mark: { type: [String, Array] },
    view: { type: String, matches: [...CODE_VIEWS], default: "change" },
    collapsed: { type: Boolean },
    expect: { type: String },
  },
  validate: rangeErrors,
};

const callout: Schema = {
  render: "Callout",
  attributes: { tone: { type: String, matches: ["key", "warn"] } },
};

const flow: Schema = { render: "Flow" };
const step: Schema = { render: "Step", attributes: { tag: { type: String } } };

const fields: Schema = { render: "Fields" };
const field: Schema = {
  render: "Field",
  attributes: {
    name: { type: String, required: true },
    kind: { type: String, required: true },
    badges: { type: Array },
    tags: { type: Array },
  },
};

const method: Schema = {
  render: "Method",
  attributes: {
    sig: { type: String, required: true },
    decorator: { type: String },
    chips: { type: Array },
  },
};

const tests: Schema = { render: "Tests" };
const test: Schema = {
  render: "Test",
  attributes: {
    name: { type: String, required: true },
    kind: { type: String, required: true, matches: ["unit", "tour", "http"] },
    ref: { type: String },
    asserts: { type: Array, required: true },
  },
};

/** Thin wrapper over a native table: same data, ✓/— cell styling. */
const matrix: Schema = { render: "Matrix" };

/** The `status` filter, shared by `files` and the `filegroup` children that split it. */
const statusFilter: SchemaAttribute = {
  type: String,
  validate(value: unknown): ValidationError[] {
    if (typeof value !== "string") return [];
    const bad = statusList(value).filter(
      (part) => !FILE_STATUSES.some((status) => status === part),
    );
    return bad.length === 0
      ? []
      : [
          {
            id: "attribute-value-invalid",
            level: "error",
            message: `Attribute 'status' must list ${FILE_STATUSES.join(", ")}. Got '${bad.join(", ")}' instead.`,
          },
        ];
  },
};

/* Not self-closing: `{% files %}` may hold `filegroup` children, and Markdoc
   rejects children only when the schema declares the tag self-closing. */
const files: Schema = {
  render: "Files",
  attributes: {
    only: { type: String },
    status: statusFilter,
    why: { type: Object },
  },
};

const filegroup: Schema = {
  render: "FileGroup",
  selfClosing: true,
  attributes: {
    label: { type: String, required: true },
    only: { type: String },
    status: statusFilter,
  },
};

const i18n: Schema = { render: "I18n", selfClosing: true };

const cards: Schema = {
  render: "Cards",
  attributes: {
    cols: {
      type: Number,
      default: 2,
      validate(value: unknown): ValidationError[] {
        return value === undefined || value === 1 || value === 2 || value === 3
          ? []
          : [
              {
                id: "attribute-value-invalid",
                level: "error",
                message: `Attribute 'cols' must be 1, 2 or 3. Got '${String(value)}' instead.`,
              },
            ];
      },
    },
  },
};
const card: Schema = {
  render: "Card",
  attributes: { icon: { type: String }, title: { type: String } },
};

const patterns: Schema = { render: "Patterns" };
const pattern: Schema = {
  render: "Pattern",
  attributes: {
    icon: { type: String },
    term: { type: String, required: true },
    ref: { type: String },
  },
};

const attrs: Schema = {
  render: "Attrs",
  selfClosing: true,
  attributes: { items: { type: Array, required: true } },
};

const diagram: Schema = {
  render: "Diagram",
  selfClosing: true,
  attributes: {
    nodes: { type: Array, required: true },
    edges: { type: Array },
    intro: { type: String },
    hint: { type: String },
  },
};

export const CORE_TAGS: Record<string, Schema> = {
  section,
  group,
  code,
  callout,
  flow,
  step,
  fields,
  field,
  method,
  tests,
  test,
  matrix,
  files,
  filegroup,
  i18n,
  cards,
  card,
  patterns,
  pattern,
  attrs,
  diagram,
  /* Markdoc's own table tag, so `{% table %}` and pipe tables both work. */
  table: Markdoc.tags.table,
};

export const CORE_TAG_NAMES: readonly string[] = Object.keys(CORE_TAGS);
