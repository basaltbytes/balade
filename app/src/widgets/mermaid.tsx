/* A ```mermaid fence. The source is pull-request text, so the diagram is drawn
   in the browser and the markup passes the sink guard in `mermaid/mermaid.ts`
   before it is injected; anything mermaid cannot draw falls back to the source
   as escaped text. */

import type { MermaidBlock } from "../contract";
import { useMermaidDiagram } from "../mermaid/use-mermaid";
import { Octicon } from "../ui/octicon";
import { useStrings } from "../ui/strings";

const FRAME = "my-4 border border-border rounded-[11px] overflow-hidden bg-background";

export function Mermaid({ block }: { block: MermaidBlock }) {
  const strings = useStrings();
  const diagram = useMermaidDiagram(block.source);

  if (diagram.state === "pending") {
    return <div className={`${FRAME} h-24`} data-mermaid="pending" aria-busy="true" />;
  }

  if (diagram.state === "drawn") {
    return (
      /* Mermaid's SVG, with every link, handler and off-document URL removed
         (`sanitizeDiagramSvg`) after mermaid's own strict-mode sanitization. */
      <div
        className={`${FRAME} flex justify-center px-3 py-4`}
        data-mermaid="drawn"
        dangerouslySetInnerHTML={{ __html: diagram.svg }}
      />
    );
  }

  return (
    <div className={FRAME} data-mermaid="unavailable">
      <div className="flex items-center gap-2 px-3 py-2 bg-muted border-b border-border text-[12px] text-muted-foreground">
        <Octicon name="info" size={14} className="shrink-0" />
        <span>{strings.mermaidUnavailable}</span>
      </div>
      <pre className="m-0 py-3 px-4 text-[12.5px] leading-[20px] font-mono overflow-auto text-secondary-foreground">
        {block.source}
      </pre>
    </div>
  );
}
