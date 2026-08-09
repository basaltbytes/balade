import { useEffect, useState } from "react";
import type { ShikiTransformer } from "shiki/core";
import { runAppEffect } from "../data/runtime";
import { hasOverlongHighlightLine, highlightCode, withHighlightFallback } from "./shiki";

/** Highlighted HTML, or `null` while unavailable or deliberately skipped. */
export function useHighlighted(
  code: string,
  lang: string,
  transformers: ReadonlyArray<ShikiTransformer>,
): string | null {
  const [html, setHtml] = useState<string | null>(null);
  const overlongLine = hasOverlongHighlightLine(code);

  useEffect(() => {
    setHtml(null);
    if (overlongLine) return;
    return runAppEffect(
      highlightCode(code, lang, transformers).pipe(withHighlightFallback(null)),
      setHtml,
    );
  }, [code, lang, overlongLine, transformers]);

  return overlongLine ? null : html;
}
