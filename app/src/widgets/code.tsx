/* {% code %}: one resolved excerpt, three reader-switchable views. The payload
   carries the authored default; the reader may change it. */

import { DiffModeEnum, DiffView } from "@git-diff-view/react";
import { useMemo, useState } from "react";
import type { CodeBlock } from "../contract";
import { codeExcerptDiff } from "../data/diff";
import { useDiffHighlighter } from "../highlight/diff-highlighter";
import { lineMarks, useHighlighted } from "../highlight/shiki";
import { Octicon } from "../ui/octicon";
import { useStrings } from "../ui/strings";

type View = "plain" | "change" | "diff";

const VIEWS: View[] = ["plain", "change", "diff"];

export function Code({ block }: { block: CodeBlock }) {
  const strings = useStrings();
  const [view, setView] = useState<View>(block.view);
  const [open, setOpen] = useState(true);

  const code = useMemo(() => block.lines.join("\n"), [block.lines]);
  const transformers = useMemo(
    () => [lineMarks(block.from, block.changed, block.mark ?? [])],
    [block.from, block.changed, block.mark],
  );
  const html = useHighlighted(code, block.lang, transformers);
  const excerpt = useMemo(
    () => codeExcerptDiff(block.lines, block.changed, block.from, block.file),
    [block.lines, block.changed, block.from, block.file],
  );
  const highlighter = useDiffHighlighter([block.lang]);
  const mismatch = block.expect?.status === "mismatch";

  return (
    <div
      className={`codeblock my-4 border border-border rounded-[11px] overflow-hidden bg-background ${open ? "" : "collapsed"}`}
    >
      <div className="flex items-center justify-between gap-3 px-3 py-2 bg-muted border-b border-border">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          title={open ? strings.collapse : strings.expand}
          className="font-mono text-[12px] text-secondary-foreground inline-flex items-center gap-2 min-w-0 cursor-pointer"
        >
          <Octicon
            name={open ? "chevron-down" : "chevron-right"}
            size={14}
            className="text-muted-foreground shrink-0"
          />
          <span className="truncate">{block.file}</span>
          <span className="text-muted-foreground shrink-0">
            {strings.lineRange(block.from, block.to)}
          </span>
        </button>
        <div className="flex items-center gap-1 text-[11px] shrink-0">
          {VIEWS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              onClick={() => {
                setView(candidate);
                setOpen(true);
              }}
              className={`px-2 py-[2px] rounded-md border cursor-pointer ${
                view === candidate
                  ? "border-primary/50 text-foreground bg-primary/10"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {strings.view[candidate]}
            </button>
          ))}
        </div>
      </div>

      {mismatch && block.expect !== undefined && (
        <div className="flex items-start gap-2 px-3 py-2 bg-modified/10 border-b border-modified/40 text-[12px] text-secondary-foreground">
          <Octicon name="alert" size={14} className="text-modified mt-[2px] shrink-0" />
          <span>
            <b className="text-modified font-semibold">{strings.expectMismatch}</b>{" "}
            {strings.expectMismatchBody(`“${block.expect.value}”`)}
          </span>
        </div>
      )}

      <div className="cbody">
        {view === "diff" ? (
          <div className="code-diff text-[12px]" data-theme="dark">
            <DiffView
              data={{
                oldFile: {
                  fileName: block.file,
                  fileLang: block.lang,
                  content: excerpt.oldContent,
                },
                newFile: {
                  fileName: block.file,
                  fileLang: block.lang,
                  content: excerpt.newContent,
                },
                hunks: excerpt.hunks,
              }}
              diffViewMode={DiffModeEnum.Split}
              diffViewTheme="dark"
              diffViewHighlight
              diffViewFontSize={12}
              diffViewWrap={false}
              {...(highlighter ? { registerHighlighter: highlighter } : {})}
            />
          </div>
        ) : html === null ? (
          <pre
            className="m-0 py-3 px-4 text-[12.5px] leading-[20px] font-mono overflow-auto text-secondary-foreground"
            style={{ tabSize: 4 }}
          >
            {code}
          </pre>
        ) : (
          /* shiki produces this markup from the payload's raw lines and escapes
             their text; the payload never carries HTML (contract rule). */
          <div
            className={view === "change" ? "view-change" : "view-plain"}
            style={{ "--ln-start": block.from - 1 } as React.CSSProperties}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  );
}
