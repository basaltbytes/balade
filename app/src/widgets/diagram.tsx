/* {% diagram %}: manual grid placement (col/row), click-to-section, hover lights
   a node's edges. Edges are straight center-to-center SVG lines; their labels
   ride the midpoint as HTML chips, so no routing engine is needed. */

import { useMemo, useState } from "react";
import type { DiagramEdge, DiagramNode, Inline } from "../contract";
import { jumpTo } from "../ui/nav";
import { Rich } from "../ui/rich";

const EDGE_COLOR: Record<DiagramEdge["kind"], string> = {
  ctx: "var(--color-context)",
  mod: "var(--color-modified)",
  new: "var(--color-added)",
  derived: "var(--color-accent-muted)",
};

const BADGE: Record<string, string> = {
  new: "text-added bg-added/12 border-added/32",
  mod: "text-modified bg-modified/12 border-modified/32",
  hub: "text-modified bg-modified/12 border-modified/32",
};

const NODE_BORDER: Record<DiagramNode["change"], string> = {
  new: "border-added/50",
  mod: "border-modified/40",
  ctx: "border-border",
};

export function Diagram({
  intro,
  hint,
  nodes,
  edges,
}: {
  intro?: Inline[];
  hint?: Inline[];
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}) {
  const [hover, setHover] = useState<string | null>(null);
  const cols = Math.max(1, ...nodes.map((node) => node.col));
  const rows = Math.max(1, ...nodes.map((node) => node.row));
  /* Every hover change re-renders the grid; the lookups hold still. */
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const byCell = useMemo(
    () => new Map(nodes.map((node) => [`${node.row}:${node.col}`, node])),
    [nodes],
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
      <div className="relative border border-border rounded-md bg-card p-4">
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
          return (
            <span
              key={`label-${index}`}
              className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none font-mono text-[10px] px-[5px] py-[1px] rounded-md border border-border bg-background text-muted-foreground whitespace-nowrap transition-opacity"
              style={{
                left: `${(a.x + b.x) / 2}%`,
                top: `${(a.y + b.y) / 2}%`,
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
                        className={`text-[10.5px] border rounded-md px-[5px] py-[1px] ${BADGE[node.badge] ?? BADGE.new}`}
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
