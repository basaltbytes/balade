/* The diff view highlights through the app's shiki instance, not its own.
   `@git-diff-view/react` takes any highlighter through `registerHighlighter`;
   this builds one from shiki, which is why `@git-diff-view/shiki` (pinned to
   shiki 3) is not a dependency here. Node styles are inline, hence type
   "style" — the renderer reads `properties.style` off the wrapper node. */

import { processAST, type DiffAST, type DiffFileHighlighter } from "@git-diff-view/react";
import { useEffect, useState } from "react";
import { ensureLangs, highlightLanguage, resolveLang, THEME } from "./shiki";
import type { HighlighterCore } from "shiki/core";

/* The two settings `@git-diff-view` writes back live per highlighter, in this
   closure — never as module state a second instance would share. */
export const createDiffHighlighter = (highlighter: HighlighterCore): DiffFileHighlighter => {
  let maxLineToIgnoreSyntax = 2000;
  const ignoreSyntaxHighlightList: (string | RegExp)[] = [];

  return {
    name: "shiki",
    type: "style",
    get maxLineToIgnoreSyntax() {
      return maxLineToIgnoreSyntax;
    },
    setMaxLineToIgnoreSyntax: (value: number) => {
      maxLineToIgnoreSyntax = value;
    },
    get ignoreSyntaxHighlightList() {
      return ignoreSyntaxHighlightList;
    },
    setIgnoreSyntaxHighlightList: (value: (string | RegExp)[]) => {
      ignoreSyntaxHighlightList.length = 0;
      ignoreSyntaxHighlightList.push(...value);
    },
    getAST: (raw: string, _fileName?: string, lang?: string): DiffAST =>
      highlighter.codeToHast(raw, {
        lang: highlightLanguage(raw, lang ?? "text"),
        theme: THEME,
      }) as DiffAST,
    processAST: (ast: DiffAST) => processAST(ast),
    hasRegisteredCurrentLang: (lang: string) => {
      const resolved = resolveLang(lang);
      return resolved === "text" || highlighter.getLoadedLanguages().includes(resolved);
    },
  } as DiffFileHighlighter;
};

interface LoadedDiffHighlighter {
  readonly key: string;
  readonly highlighter: DiffFileHighlighter;
}

/**
 * Resolves once the grammars of `langs` are in. Until then the diff renders
 * unhighlighted rather than blocking on the network.
 */
export function useDiffHighlighter(langs: string[]): DiffFileHighlighter | undefined {
  const [loaded, setLoaded] = useState<LoadedDiffHighlighter | null>(null);
  const key = langs.join(",");
  useEffect(() => {
    let alive = true;
    ensureLangs(key.length > 0 ? key.split(",") : [])
      .then((highlighter) => {
        if (alive) setLoaded({ key, highlighter: createDiffHighlighter(highlighter) });
      })
      .catch(() => {
        if (alive) setLoaded(null);
      });
    return () => {
      alive = false;
    };
  }, [key]);
  return loaded?.key === key ? loaded.highlighter : undefined;
}
