import type { CardItem, Inline, PatternItem, TestItem } from "../contract";
import { Chip } from "../ui/bits";
import { Octicon } from "../ui/octicon";
import { Rich, Tag } from "../ui/rich";

export function Method({
  decorator,
  chips,
  sig,
  body,
}: {
  decorator?: string;
  chips?: ReadonlyArray<string>;
  sig: string;
  body: ReadonlyArray<Inline>;
}) {
  return (
    <div className="my-3 border border-border rounded-md bg-card px-4 py-3">
      {decorator !== undefined && (
        <div className="font-mono text-[12px] text-done">{decorator}</div>
      )}
      <div className="flex items-center flex-wrap gap-2 mb-1">
        <span className="font-mono text-[13px] text-accent-muted">{sig}</span>
        {chips?.map((chip) => (
          <Chip key={chip} tone="done">
            {chip}
          </Chip>
        ))}
      </div>
      <div className="text-[13px] text-secondary-foreground leading-relaxed">
        <Rich v={body} />
      </div>
    </div>
  );
}

export function Tests({ items }: { items: ReadonlyArray<TestItem> }) {
  return (
    <div className="my-4 grid gap-3 md:grid-cols-2">
      {items.map((item, index) => (
        <div key={index} className="border border-border rounded-md bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Octicon name="beaker" size={14} className="text-done" />
            <span className="font-mono text-[13px] text-foreground">{item.name}</span>
            <Tag>{item.kind}</Tag>
          </div>
          <div className="text-[13px] text-secondary-foreground leading-relaxed mb-2">
            <Rich v={item.scenario} />
          </div>
          <ul className="space-y-1">
            {item.asserts.map((assertion, k) => (
              <li
                key={k}
                className="text-[13px] text-secondary-foreground leading-relaxed flex gap-2"
              >
                <Octicon name="check" size={14} className="text-added mt-[3px] shrink-0" />
                <span>
                  <Rich v={assertion} />
                </span>
              </li>
            ))}
          </ul>
          {item.ref !== undefined && (
            <div className="mt-2 font-mono text-[11.5px] text-muted-foreground">{item.ref}</div>
          )}
        </div>
      ))}
    </div>
  );
}

export function Cards({ cols, items }: { cols: 1 | 2 | 3; items: ReadonlyArray<CardItem> }) {
  const grid = cols === 3 ? "md:grid-cols-3" : cols === 2 ? "md:grid-cols-2" : "";
  return (
    <div className={`my-4 grid gap-3 ${grid}`}>
      {items.map((item, index) => (
        <div key={index} className="border border-border rounded-md bg-card p-4">
          {(item.icon !== undefined || item.title !== undefined) && (
            <div className="flex items-center gap-2 mb-2 font-semibold text-[13.5px]">
              {item.icon !== undefined && (
                <Octicon name={item.icon} size={15} className="text-muted-foreground" />
              )}
              {item.title}
            </div>
          )}
          {item.body.map((paragraph, k) => (
            <p
              key={k}
              className="text-[13px] text-secondary-foreground leading-relaxed my-1.5 first:mt-0 last:mb-0"
            >
              <Rich v={paragraph} />
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

export function Patterns({ items }: { items: ReadonlyArray<PatternItem> }) {
  return (
    <div className="my-4 grid gap-3 md:grid-cols-2">
      {items.map((item, index) => (
        <div key={index} className="border border-border rounded-md bg-card p-4 flex gap-3">
          <Octicon name={item.icon} size={16} className="text-accent-muted mt-[2px] shrink-0" />
          <div className="min-w-0">
            <div className="font-semibold text-[13.5px] mb-1">{item.term}</div>
            <div className="text-[13px] text-secondary-foreground leading-relaxed">
              <Rich v={item.body} />
            </div>
            {item.ref !== undefined && (
              <div className="mt-1.5 font-mono text-[11.5px] text-muted-foreground truncate">
                {item.ref}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
