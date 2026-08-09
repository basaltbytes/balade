/**
 * Diagram attributes arrive as plain data (the prop contract forbids rich text
 * in attributes), so nodes and edges only need coercion into the payload shape.
 */

import type { Node } from "@markdoc/markdoc";
import type { DiagramBlock, DiagramEdge, DiagramNode, Inline } from "./types.js";

const CHANGES = ["new", "mod", "ctx"] as const;
const EDGE_KINDS = ["new", "mod", "ctx", "derived"] as const;
export const MAX_DIAGRAM_GRID_SIZE = 64;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function inlineRow(value: unknown): Inline[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  return [String(value)];
}

function gridCoordinate(value: unknown): number {
  const coordinate = Number(value ?? 1);
  if (Number.isNaN(coordinate)) return 1;
  return Math.min(MAX_DIAGRAM_GRID_SIZE, Math.max(1, Math.trunc(coordinate)));
}

export function diagramNodes(value: unknown): DiagramNode[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw, index): DiagramNode[] => {
    if (!isRecord(raw)) return [];
    const record = raw;
    const change = CHANGES.find((c) => c === record["change"]) ?? "ctx";
    const rawCompartments = record["compartments"];
    const compartments = Array.isArray(rawCompartments)
      ? rawCompartments.flatMap((entry): DiagramNode["compartments"] => {
          if (!isRecord(entry)) return [];
          const box = entry;
          const rawRows = box["rows"];
          const rows = Array.isArray(rawRows) ? rawRows.map(inlineRow) : [];
          return [{ label: String(box["label"] ?? ""), rows }];
        })
      : [];
    const node: DiagramNode = {
      id: String(record["id"] ?? `n-${index}`),
      model: String(record["model"] ?? ""),
      change,
      col: gridCoordinate(record["col"]),
      row: gridCoordinate(record["row"]),
      compartments,
      ...(typeof record["nlabel"] === "string" ? { nlabel: record["nlabel"] } : {}),
      ...(typeof record["badge"] === "string" ? { badge: record["badge"] } : {}),
      ...(typeof record["ref"] === "string" ? { ref: record["ref"] } : {}),
    };
    return [node];
  });
}

function diagramEdges(value: unknown): DiagramEdge[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): DiagramEdge[] => {
    if (!isRecord(raw)) return [];
    const record = raw;
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
