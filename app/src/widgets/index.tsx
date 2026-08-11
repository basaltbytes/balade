/* One renderer per block kind of the catalog; a namespaced preset node the app
   has no renderer for shows a labeled placeholder instead of vanishing. */

import { memo } from "react";
import type { Block, PresetBlock } from "../contract";
import { Octicon } from "../ui/octicon";
import { useStrings } from "../ui/strings";
import { Cards, Method, Patterns, Tests } from "./cards";
import { Code } from "./code";
import { Diagram } from "./diagram";
import { Files } from "./files";
import { Mermaid } from "./mermaid";
import { Attrs, Callout, Flow, Md } from "./prose";
import { DataTable, Fields, I18nTable, Matrix } from "./tables";

function PresetPlaceholder({ block }: { block: PresetBlock }) {
  const strings = useStrings();
  return (
    <div className="my-3 border border-dashed border-border rounded-md px-4 py-3 text-[12.5px] text-muted-foreground inline-flex items-center gap-2">
      <Octicon name="package" size={14} />
      <span className="font-mono text-secondary-foreground">{block.b}</span>
      <span>{strings.unknownBlock(block.b)}</span>
    </div>
  );
}

/* Blocks are stable payload references, so memo keeps every untouched widget
   out of the re-render a review mark causes. */
export const BlockView = memo(function BlockView({ block }: { block: Block }) {
  switch (block.b) {
    case "md":
      return <Md nodes={block.nodes} />;
    case "callout":
      return <Callout {...(block.tone ? { tone: block.tone } : {})} body={block.body} />;
    case "flow":
      return <Flow steps={block.steps} />;
    case "fields":
      return <Fields rows={block.rows} />;
    case "method":
      return (
        <Method
          sig={block.sig}
          body={block.body}
          {...(block.decorator !== undefined ? { decorator: block.decorator } : {})}
          {...(block.chips !== undefined ? { chips: block.chips } : {})}
        />
      );
    case "tests":
      return <Tests items={block.items} />;
    case "matrix":
      return <Matrix head={block.head} rows={block.rows} />;
    case "table":
      return (
        <DataTable
          head={block.head}
          rows={block.rows}
          {...(block.firstColMono !== undefined ? { firstColMono: block.firstColMono } : {})}
        />
      );
    case "files":
      return <Files paths={block.paths} />;
    case "i18n":
      return (
        <I18nTable rows={block.rows} {...(block.note !== undefined ? { note: block.note } : {})} />
      );
    case "cards":
      return <Cards cols={block.cols} items={block.items} />;
    case "patterns":
      return <Patterns items={block.items} />;
    case "attrs":
      return <Attrs items={block.items} />;
    case "diagram":
      return (
        <Diagram
          nodes={block.nodes}
          edges={block.edges}
          {...(block.intro !== undefined ? { intro: block.intro } : {})}
          {...(block.hint !== undefined ? { hint: block.hint } : {})}
        />
      );
    case "mermaid":
      return <Mermaid block={block} />;
    case "code":
      return <Code block={block} />;
    default:
      return <PresetPlaceholder block={block} />;
  }
});
