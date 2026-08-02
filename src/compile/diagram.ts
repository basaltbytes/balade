/**
 * Diagram attributes arrive as plain data (the prop contract forbids rich text
 * in attributes), so nodes and edges only need coercion into the payload shape.
 */

import type { Node } from "@markdoc/markdoc";
import type { DiagramBlock, DiagramEdge, DiagramNode, Inline } from "../payload/types.js";

const CHANGES = ["new", "mod", "ctx"] as const;
const EDGE_KINDS = ["new", "mod", "ctx", "derived"] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function inlineRow(value: unknown): Inline[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  return [String(value)];
}

export function diagramNodes(value: unknown): DiagramNode[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw, index): DiagramNode[] => {
    const record = asRecord(raw);
    if (record === null) return [];
    const change = CHANGES.find((c) => c === record["change"]) ?? "ctx";
    const compartments = Array.isArray(record["compartments"])
      ? (record["compartments"] as unknown[]).flatMap((entry): DiagramNode["compartments"] => {
          const box = asRecord(entry);
          if (box === null) return [];
          const rows = Array.isArray(box["rows"]) ? (box["rows"] as unknown[]).map(inlineRow) : [];
          return [{ label: String(box["label"] ?? ""), rows }];
        })
      : [];
    const node: DiagramNode = {
      id: String(record["id"] ?? `n-${index}`),
      model: String(record["model"] ?? ""),
      change,
      col: Number(record["col"] ?? 1),
      row: Number(record["row"] ?? 1),
      compartments,
      ...(typeof record["nlabel"] === "string" ? { nlabel: record["nlabel"] } : {}),
      ...(typeof record["badge"] === "string" ? { badge: record["badge"] } : {}),
      ...(typeof record["ref"] === "string" ? { ref: record["ref"] } : {}),
    };
    return [node];
  });
}

export function diagramEdges(value: unknown): DiagramEdge[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): DiagramEdge[] => {
    const record = asRecord(raw);
    if (record === null) return [];
    const kind = EDGE_KINDS.find((k) => k === record["kind"]) ?? "ctx";
    const edge: DiagramEdge = {
      from: String(record["from"] ?? ""),
      to: String(record["to"] ?? ""),
      kind,
      ...(typeof record["label"] === "string" ? { label: record["label"] } : {}),
      ...(record["thick"] === true ? { thick: true } : {}),
    };
    return [edge];
  });
}

/** The whole `diagram` transform, shared by the core tag and the odoo `o-diagram`. */
export function diagramBlock(node: Node): DiagramBlock {
  const intro = node.attributes["intro"];
  const hint = node.attributes["hint"];
  return {
    b: "diagram",
    nodes: diagramNodes(node.attributes["nodes"]),
    edges: diagramEdges(node.attributes["edges"]),
    ...(typeof intro === "string" ? { intro: [intro] } : {}),
    ...(typeof hint === "string" ? { hint: [hint] } : {}),
  };
}
