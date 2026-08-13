/* An authored fence rendered read-only. The source is untrusted PR-authored
   text: shiki emits escaped tokens, and until highlight resolves the raw text
   renders through React's own escaping, so it never gains a markup channel. */

import type { FenceBlock } from "../contract";
import { useHighlighted } from "../highlight/use-highlighted";

const NO_TRANSFORMERS: never[] = [];

export function Fence({ block }: { block: FenceBlock }) {
  const html = useHighlighted(block.source, block.lang, NO_TRANSFORMERS);
  return (
    <div className="codeblock my-4 border border-border rounded-[11px] overflow-hidden bg-background">
      <div className="cbody">
        {html === null ? (
          <pre
            className="m-0 py-3 px-4 text-[12.5px] leading-[20px] font-mono overflow-auto text-secondary-foreground"
            style={{ tabSize: 4 }}
          >
            {block.source}
          </pre>
        ) : (
          <div className="view-plain" dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>
    </div>
  );
}
