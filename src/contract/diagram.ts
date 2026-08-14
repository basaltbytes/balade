/**
 * Diagram attributes arrive as plain data (the prop contract forbids rich text
 * in attributes), so nodes and edges only need coercion into the payload shape.
 */

import type { Node, Scalar } from "@markdoc/markdoc";
import { Predicate } from "effect";
import type { DiagramBlock, DiagramEdge, DiagramNode, Inline } from "./types.js";

const CHANGES = ["new", "mod", "ctx"] as const;
const EDGE_KINDS = ["new", "mod", "ctx", "derived"] as const;
export const MAX_DIAGRAM_GRID_SIZE = 64;

const isScalarRecord = (value: Scalar | undefined): value is { [key: string]: Scalar } =>
  Predicate.isObject(value);

function inlineRow(value: Scalar): Inline[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  return [String(value)];
}

function gridCoordinate(value: Scalar | undefined): number {
  const coordinate = Number(value ?? 1);
  if (Number.isNaN(coordinate)) return 1;
  return Math.min(MAX_DIAGRAM_GRID_SIZE, Math.max(1, Math.trunc(coordinate)));
}

type DiagramNodeFacets = { nlabel?: string; badge?: string; ref?: string };

export function diagramNodes(value: Scalar | undefined): DiagramNode[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((record, index): DiagramNode[] => {
    if (!isScalarRecord(record)) return [];
    const change = CHANGES.find((c) => c === record["change"]) ?? "ctx";
    const rawCompartments = record["compartments"];
    const compartments = Array.isArray(rawCompartments)
      ? rawCompartments.flatMap((box): DiagramNode["compartments"] => {
          if (!isScalarRecord(box)) return [];
          const rawRows = box["rows"];
          const rows = Array.isArray(rawRows) ? rawRows.map(inlineRow) : [];
          return [{ label: String(box["label"] ?? ""), rows }];
        })
      : [];
    const facets: DiagramNodeFacets = {};
    const nlabel = record["nlabel"];
    if (Predicate.isString(nlabel)) facets.nlabel = nlabel;
    const badge = record["badge"];
    if (Predicate.isString(badge)) facets.badge = badge;
    const ref = record["ref"];
    if (Predicate.isString(ref)) facets.ref = ref;
    const node: DiagramNode = {
      id: String(record["id"] ?? `n-${index}`),
      model: String(record["model"] ?? ""),
      change,
      col: gridCoordinate(record["col"]),
      row: gridCoordinate(record["row"]),
      compartments,
      ...facets,
    };
    return [node];
  });
}

type DiagramEdgeFacets = { label?: string; thick?: boolean };

function diagramEdges(value: Scalar | undefined): DiagramEdge[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((record): DiagramEdge[] => {
    if (!isScalarRecord(record)) return [];
    const kind = EDGE_KINDS.find((k) => k === record["kind"]) ?? "ctx";
    const facets: DiagramEdgeFacets = {};
    const label = record["label"];
    if (Predicate.isString(label)) facets.label = label;
    if (record["thick"] === true) facets.thick = true;
    const edge: DiagramEdge = {
      from: String(record["from"] ?? ""),
      to: String(record["to"] ?? ""),
      kind,
      ...facets,
    };
    return [edge];
  });
}

type DiagramBlockFacets = { intro?: Inline[]; hint?: Inline[] };

/** The whole `diagram` transform, shared by the core tag and the odoo `o-diagram`. */
export function diagramBlock(node: Node): DiagramBlock {
  const facets: DiagramBlockFacets = {};
  const intro = node.attributes["intro"];
  if (Predicate.isString(intro)) facets.intro = [intro];
  const hint = node.attributes["hint"];
  if (Predicate.isString(hint)) facets.hint = [hint];
  return {
    b: "diagram",
    nodes: diagramNodes(node.attributes["nodes"]),
    edges: diagramEdges(node.attributes["edges"]),
    ...facets,
  };
}
