/* The six inline kinds of the contract. Arrays flatten into fragments. */

import { Predicate } from "effect";
import type { ReactNode } from "react";
import type { Inline } from "../contract";

export function Rich({ v }: { v: Inline | undefined }): ReactNode {
  if (v === undefined || v === null) return null;
  if (Predicate.isString(v)) return v;
  if (Array.isArray(v)) return v.map((x, k) => <Rich key={k} v={x} />);
  if ("c" in v)
    return (
      <code className="font-mono text-[0.92em] bg-secondary/60 border border-border-soft rounded-[4px] px-[5px] py-[1px] whitespace-nowrap">
        {v.c}
      </code>
    );
  if ("b" in v)
    return (
      <b className="font-semibold text-foreground">
        <Rich v={v.b} />
      </b>
    );
  if ("i" in v)
    return (
      <i>
        <Rich v={v.i} />
      </i>
    );
  if ("m" in v) return <span className="font-mono text-[0.95em] text-accent-muted">{v.m}</span>;
  if ("tag" in v) return <Tag>{v.tag}</Tag>;
  return null;
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[11px] text-secondary-foreground bg-secondary border border-border rounded-md px-[6px] py-[1px] whitespace-nowrap">
      {children}
    </span>
  );
}
