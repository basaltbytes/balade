import type { Block, MdNode } from "../contract";
import { Banner } from "../ui/bits";
import { Rich } from "../ui/rich";
import { useStrings } from "../ui/strings";

type CalloutProps = Omit<Extract<Block, { readonly b: "callout" }>, "b">;
type CalloutTone = NonNullable<CalloutProps["tone"]>;

const CALLOUT_ICON = {
  key: "light-bulb",
  warn: "alert",
} satisfies Record<CalloutTone, string>;

export function Md({ nodes }: { nodes: ReadonlyArray<MdNode> }) {
  return (
    <>
      {nodes.map((node, index) => {
        if ("h" in node)
          return (
            <h3 key={index} className="text-[17px] font-semibold mt-8 mb-2 tracking-[-0.01em]">
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
              className="my-4 pl-6 list-decimal text-prose text-secondary-foreground marker:text-muted-foreground"
            >
              {items}
            </ol>
          ) : (
            <ul
              key={index}
              className="my-4 pl-6 list-disc text-prose text-secondary-foreground marker:text-muted-foreground"
            >
              {items}
            </ul>
          );
        }
        return (
          <p key={index} className="my-4 text-prose text-secondary-foreground">
            <Rich v={node.p} />
          </p>
        );
      })}
    </>
  );
}

export function Callout({ tone, body }: CalloutProps) {
  const strings = useStrings();
  if (tone !== undefined) {
    return (
      <Banner tone={tone} icon={CALLOUT_ICON[tone]} title={strings.calloutTitle[tone]}>
        <Rich v={body} />
      </Banner>
    );
  }
  return (
    <div className="my-4 border border-border rounded-lg bg-card px-4 py-3 leading-relaxed text-secondary-foreground">
      <Rich v={body} />
    </div>
  );
}

export function Attrs({ items }: { items: ReadonlyArray<string> }) {
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
