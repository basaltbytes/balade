/* {% diagram %}: manual grid placement (col/row), click-to-section, hover lights
   a node's edges. Edges are straight center-to-center SVG lines; their labels
   ride as HTML chips, so no routing engine is needed. A label sits at the
   midpoint of its edge's visible run — the stretch between the two node
   borders, measured after layout — because the raw center-to-center midpoint
   lands under a node box whenever the two boxes sit close. */

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DiagramEdge, DiagramNode, Inline } from "../contract";
import { jumpTo } from "../ui/nav";
import { Rich } from "../ui/rich";

interface Point {
  readonly x: number;
  readonly y: number;
}

/** Parameter t at which the segment a→b leaves the axis-aligned rect around a. */
function exitParameter(a: Point, b: Point, rect: DOMRect): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const tx = dx === 0 ? Infinity : ((dx > 0 ? rect.right : rect.left) - a.x) / dx;
  const ty = dy === 0 ? Infinity : ((dy > 0 ? rect.bottom : rect.top) - a.y) / dy;
  return Math.min(tx, ty);
}

interface LabelSpot extends Point {
  /** True when the visible run is too short for the chip, which then renders
      above the node boxes instead of being sliced by them. */
  readonly lifted: boolean;
}

/** Midpoint of the edge's visible run, in percent of the container. */
function labelSpot(container: DOMRect, from: DOMRect, to: DOMRect, chipWidth: number): LabelSpot {
  const a = { x: (from.left + from.right) / 2, y: (from.top + from.bottom) / 2 };
  const b = { x: (to.left + to.right) / 2, y: (to.top + to.bottom) / 2 };
  const exit = exitParameter(a, b, from);
  const enter = 1 - exitParameter(b, a, to);
  /* Overlapping boxes leave no visible run; fall back to the raw midpoint. */
  const t = exit < enter ? (exit + enter) / 2 : 0.5;
  const x = a.x + t * (b.x - a.x);
  const y = a.y + t * (b.y - a.y);
  const run = exit < enter ? (enter - exit) * Math.hypot(b.x - a.x, b.y - a.y) : 0;
  return {
    x: ((x - container.left) / container.width) * 100,
    y: ((y - container.top) / container.height) * 100,
    lifted: run < chipWidth + 6,
  };
}

const EDGE_COLOR = {
  ctx: "var(--color-context)",
  mod: "var(--color-modified)",
  new: "var(--color-added)",
  derived: "var(--color-accent-muted)",
} satisfies Record<DiagramEdge["kind"], string>;

const NEW_BADGE = "text-added bg-added/12 border-added/32";
const BADGE = new Map(
  Object.entries({
    new: NEW_BADGE,
    mod: "text-modified bg-modified/12 border-modified/32",
    hub: "text-modified bg-modified/12 border-modified/32",
  }),
);

const NODE_BORDER = {
  new: "border-added/50",
  mod: "border-modified/40",
  ctx: "border-border",
} satisfies Record<DiagramNode["change"], string>;

const MAX_DIAGRAM_GRID_SIZE = 64;

const gridCoordinate = (coordinate: number): number =>
  Math.min(MAX_DIAGRAM_GRID_SIZE, Math.max(1, coordinate));

export function Diagram({
  intro,
  hint,
  nodes,
  edges,
}: {
  intro?: ReadonlyArray<Inline>;
  hint?: ReadonlyArray<Inline>;
  nodes: ReadonlyArray<DiagramNode>;
  edges: ReadonlyArray<DiagramEdge>;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef(new Map<string, HTMLElement>());
  const labelRefs = useRef(new Map<number, HTMLElement>());
  const [spots, setSpots] = useState<ReadonlyMap<number, LabelSpot>>(new Map());
  const gridNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        col: gridCoordinate(node.col),
        row: gridCoordinate(node.row),
      })),
    [nodes],
  );
  const cols = Math.max(1, ...gridNodes.map((node) => node.col));
  const rows = Math.max(1, ...gridNodes.map((node) => node.row));

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const measure = (): void => {
      const box = container.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;
      const next = new Map<number, LabelSpot>();
      edges.forEach((edge, index) => {
        if (edge.label === undefined) return;
        const from = nodeRefs.current.get(edge.from)?.getBoundingClientRect();
        const to = nodeRefs.current.get(edge.to)?.getBoundingClientRect();
        const chip = labelRefs.current.get(index)?.offsetWidth ?? 0;
        if (from !== undefined && to !== undefined) next.set(index, labelSpot(box, from, to, chip));
      });
      setSpots(next);
    };
    measure();
    if (globalThis.ResizeObserver === undefined) return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [edges]);
  /* Every hover change re-renders the grid; the lookups hold still. */
  const byId = useMemo(() => new Map(gridNodes.map((node) => [node.id, node])), [gridNodes]);
  const byCell = useMemo(
    () => new Map(gridNodes.map((node) => [`${node.row}:${node.col}`, node])),
    [gridNodes],
  );
  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const link = (a: string, b: string): void => {
      const set = map.get(a) ?? new Set<string>();
      set.add(b);
      map.set(a, set);
    };
    for (const edge of edges) {
      link(edge.from, edge.to);
      link(edge.to, edge.from);
    }
    return map;
  }, [edges]);
  const center = (node: DiagramNode) => ({
    x: ((node.col - 0.5) / cols) * 100,
    y: ((node.row - 0.5) / rows) * 100,
  });
  const lit = (edge: DiagramEdge) => hover === null || edge.from === hover || edge.to === hover;

  return (
    <div className="my-4">
      {intro !== undefined && (
        <p className="text-[13px] text-secondary-foreground leading-relaxed mb-3">
          <Rich v={intro} />
        </p>
      )}
      <div ref={containerRef} className="relative border border-border rounded-lg bg-card p-4">
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          preserveAspectRatio="none"
          viewBox="0 0 100 100"
          aria-hidden="true"
        >
          {edges.map((edge, index) => {
            const from = byId.get(edge.from);
            const to = byId.get(edge.to);
            if (!from || !to) return null;
            const a = center(from);
            const b = center(to);
            return (
              <line
                key={index}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={EDGE_COLOR[edge.kind]}
                strokeWidth={edge.thick === true ? 1.1 : 0.45}
                strokeDasharray={edge.kind === "derived" ? "2 1.4" : undefined}
                opacity={lit(edge) ? 0.9 : 0.15}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>
        {edges.map((edge, index) => {
          const from = byId.get(edge.from);
          const to = byId.get(edge.to);
          if (!from || !to || edge.label === undefined) return null;
          const a = center(from);
          const b = center(to);
          const spot = spots.get(index) ?? {
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
            lifted: false,
          };
          return (
            <span
              key={`label-${index}`}
              ref={(el) => {
                if (el === null) labelRefs.current.delete(index);
                else labelRefs.current.set(index, el);
              }}
              className={`absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none font-mono text-[10px] px-[5px] py-[1px] rounded-md border border-border bg-background text-muted-foreground whitespace-nowrap transition-opacity ${
                spot.lifted ? "z-10" : ""
              }`}
              style={{
                left: `${spot.x}%`,
                top: `${spot.y}%`,
                opacity: lit(edge) ? 1 : 0.2,
                color: lit(edge) ? EDGE_COLOR[edge.kind] : undefined,
              }}
            >
              {edge.label}
            </span>
          );
        })}
        <div
          className="relative grid gap-x-6 gap-y-10"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: rows }, (_, row) =>
            Array.from({ length: cols }, (_, col) => {
              const node = byCell.get(`${row + 1}:${col + 1}`);
              if (!node) return <div key={`${row}-${col}`} />;
              const dim =
                hover !== null && hover !== node.id && neighbours.get(hover)?.has(node.id) !== true;
              return (
                <a
                  key={node.id}
                  ref={(el) => {
                    if (el === null) nodeRefs.current.delete(node.id);
                    else nodeRefs.current.set(node.id, el);
                  }}
                  href={node.ref === undefined ? undefined : `#${node.ref}`}
                  onClick={(event) => {
                    if (node.ref === undefined) return;
                    event.preventDefault();
                    jumpTo(node.ref);
                  }}
                  onMouseEnter={() => setHover(node.id)}
                  onMouseLeave={() => setHover(null)}
                  className={`block border rounded-md bg-background transition-opacity ${
                    dim ? "opacity-30" : ""
                  } ${NODE_BORDER[node.change]}`}
                >
                  <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border-soft">
                    <span className="font-mono text-[12px] text-foreground">{node.model}</span>
                    {node.badge !== undefined ? (
                      <span
                        className={`text-[10.5px] border rounded-md px-[5px] py-[1px] ${BADGE.get(node.badge) ?? NEW_BADGE}`}
                      >
                        {node.badge}
                      </span>
                    ) : (
                      node.nlabel !== undefined && (
                        <span className="text-[11px] text-muted-foreground">{node.nlabel}</span>
                      )
                    )}
                  </div>
                  {node.compartments.map((compartment, index) => (
                    <div
                      key={index}
                      className="px-3 py-1.5 border-b border-border-soft last:border-b-0"
                    >
                      <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">
                        {compartment.label}
                      </div>
                      {compartment.rows.map((cells, k) => (
                        <div key={k} className="font-mono text-[11.5px] text-secondary-foreground">
                          <Rich v={cells} />
                        </div>
                      ))}
                    </div>
                  ))}
                </a>
              );
            }),
          )}
        </div>
      </div>
      {hint !== undefined && (
        <p className="text-[12.5px] text-muted-foreground leading-relaxed mt-2">
          <Rich v={hint} />
        </p>
      )}
    </div>
  );
}
