/* The diff view highlights through the app's shiki instance, not its own.
   `@git-diff-view/react` takes any highlighter through `registerHighlighter`;
   this builds one from shiki, which is why `@git-diff-view/shiki` (pinned to
   shiki 3) is not a dependency here. Node styles are inline, hence type
   "style" — the renderer reads `properties.style` off the wrapper node. */

import { processAST, type DiffAST, type DiffFileHighlighter } from "@git-diff-view/react";
import { useEffect, useState } from "react";
import { ensureLangs, resolveLang, THEME } from "./shiki";
import type { HighlighterCore } from "shiki/core";

/* The two settings `@git-diff-view` writes back live per highlighter, in this
   closure — never as module state a second instance would share. */
const build = (highlighter: HighlighterCore): DiffFileHighlighter => {
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
        lang: resolveLang(lang ?? "text"),
        theme: THEME,
      }) as DiffAST,
    processAST: (ast: DiffAST) => processAST(ast),
    hasRegisteredCurrentLang: (lang: string) =>
      highlighter.getLoadedLanguages().includes(resolveLang(lang)),
  } as DiffFileHighlighter;
};

/**
 * Resolves once the grammars of `langs` are in. Until then the diff renders
 * unhighlighted rather than blocking on the network.
 */
export function useDiffHighlighter(langs: string[]): DiffFileHighlighter | undefined {
  const [registered, setRegistered] = useState<DiffFileHighlighter | undefined>(undefined);
  const key = langs.join(",");
  useEffect(() => {
    let alive = true;
    ensureLangs(key.length > 0 ? key.split(",") : [])
      .then((highlighter) => {
        if (alive) setRegistered(build(highlighter));
      })
      .catch(() => {
        if (alive) setRegistered(undefined);
      });
    return () => {
      alive = false;
    };
  }, [key]);
  return registered;
}
