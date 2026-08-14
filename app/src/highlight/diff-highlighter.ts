/* The diff view highlights through the app's shiki instance, not its own.
   `@git-diff-view/react` takes any highlighter through `registerHighlighter`;
   this builds one from shiki, which is why `@git-diff-view/shiki` (pinned to
   shiki 3) is not a dependency here. Node styles are inline, hence type
   "style" — the renderer reads `properties.style` off the wrapper node. */

import { processAST, type DiffAST, type DiffFileHighlighter } from "@git-diff-view/react";
import { Effect, Result } from "effect";
import { useEffect, useState } from "react";
import { reportAppEffect, runAppEffect } from "../data/runtime";
import {
  ensureLangs,
  type HighlightFailure,
  HighlightLanguageCheckFailed,
  logHighlightFailure,
  renderCodeAst,
  resolveLang,
  withHighlightFallback,
} from "./shiki";
import type { HighlighterCore } from "shiki/core";

/* The two settings `@git-diff-view` writes back live per highlighter, in this
   closure — never as module state a second instance would share. */
type DiffShiki = Pick<HighlighterCore, "codeToHast" | "getLoadedLanguages">;
type ReportHighlightFailure = (error: HighlightFailure) => void;

const plaintextAst = (raw: string): DiffAST => ({
  type: "root",
  children: [{ type: "text", value: raw }],
});

export const createDiffHighlighter = (
  highlighter: DiffShiki,
  reportFailure: ReportHighlightFailure,
): DiffFileHighlighter => {
  let maxLineToIgnoreSyntax = 2000;
  let registryAvailable = true;
  const ignoreSyntaxHighlightList: (string | RegExp)[] = [];

  /* SAFETY: the literal implements the DiffFileHighlighter plugin surface;
     the cast bridges the structurally identical `hast` Root copies that shiki
     and @git-diff-view/react each declare (see DECISIONS.md). */
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
    getAST: (raw: string, _fileName?: string, lang?: string): DiffAST => {
      if (!registryAvailable) return plaintextAst(raw);
      const rendered = renderCodeAst(highlighter, raw, lang ?? "text");
      if (Result.isFailure(rendered)) {
        reportFailure(rendered.failure);
        return plaintextAst(raw);
      }
      /* SAFETY: shiki and @git-diff-view/react carry structurally identical
         `hast` Root declarations; the cast bridges the two copies, no
         unchecked runtime value passes through (see DECISIONS.md). */
      return rendered.success as DiffAST;
    },
    processAST: (ast: DiffAST) => processAST(ast),
    hasRegisteredCurrentLang: (lang: string) => {
      const resolved = resolveLang(lang);
      if (resolved === "text") return true;
      const registered = Result.try({
        try: () => highlighter.getLoadedLanguages().includes(resolved),
        catch: (cause) => new HighlightLanguageCheckFailed({ language: resolved, cause }),
      });
      if (Result.isFailure(registered)) {
        registryAvailable = false;
        reportFailure(registered.failure);
        return true;
      }
      return registered.success;
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
    const reportFailure: ReportHighlightFailure = (error) => {
      reportAppEffect(logHighlightFailure(error));
    };
    return runAppEffect(
      ensureLangs(key.length > 0 ? key.split(",") : []).pipe(
        Effect.map((highlighter) => createDiffHighlighter(highlighter, reportFailure)),
        withHighlightFallback(undefined),
      ),
      (highlighter) => setLoaded(highlighter === undefined ? null : { key, highlighter }),
    );
  }, [key]);
  return loaded?.key === key ? loaded.highlighter : undefined;
}
