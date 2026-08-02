import type { Inline, MdNode } from "../contract";
import { Rich, Tag } from "../ui/rich";

export function Md({ nodes }: { nodes: MdNode[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        if ("h" in node)
          return (
            <h3 key={index} className="text-[15px] font-semibold mt-5 mb-2">
              {node.h}
            </h3>
          );
        if ("list" in node) {
          const items = node.list.map((item, k) => (
            <li key={k} className="my-1">
              <Rich v={item} />
            </li>
          ));
          return node.ordered === true ? (
            <ol
              key={index}
              className="my-3 pl-6 list-decimal text-secondary-foreground leading-relaxed"
            >
              {items}
            </ol>
          ) : (
            <ul
              key={index}
              className="my-3 pl-6 list-disc text-secondary-foreground leading-relaxed"
            >
              {items}
            </ul>
          );
        }
        return (
          <p key={index} className="my-3 leading-relaxed text-secondary-foreground">
            <Rich v={node.p} />
          </p>
        );
      })}
    </>
  );
}

export function Callout({ tone, body }: { tone?: "key" | "warn"; body: Inline[] }) {
  const styles =
    tone === "key"
      ? "border-primary/50 bg-primary/10"
      : tone === "warn"
        ? "border-modified/50 bg-modified/10"
        : "border-border bg-card";
  return (
    <div
      className={`my-4 border rounded-md px-4 py-3 leading-relaxed text-secondary-foreground ${styles}`}
    >
      <Rich v={body} />
    </div>
  );
}

export function Flow({ steps }: { steps: { body: Inline[]; tag?: string }[] }) {
  return (
    <div className="my-4 flex flex-wrap items-center gap-y-2 text-[13px]">
      {steps.map((step, index) => (
        <span key={index} className="inline-flex items-center">
          <span className="inline-flex items-center gap-2 border border-border bg-card rounded-md px-3 py-[6px]">
            <Rich v={step.body} />
            {step.tag !== undefined && <Tag>{step.tag}</Tag>}
          </span>
          {index < steps.length - 1 && <span className="mx-2 text-muted-foreground">→</span>}
        </span>
      ))}
    </div>
  );
}

export function Attrs({ items }: { items: string[] }) {
  return (
    <div className="my-3 flex flex-wrap gap-2">
      {items.map((item, index) => (
        <span
          key={index}
          className="font-mono text-[12px] text-accent-muted bg-card border border-border rounded-md px-2 py-[3px]"
        >
          {item}
        </span>
      ))}
    </div>
  );
}
