/* One shiki instance for the whole app, `github-dark-default` everywhere.
   Fine-grained over a curated grammar map (the trade-off is in DECISIONS.md);
   adding a language is one line in `LANGS` below. */

import githubDarkDefault from "@shikijs/themes/github-dark-default";
import { useEffect, useState } from "react";
import {
  createHighlighterCore,
  type HighlighterCore,
  type LanguageRegistration,
  type ShikiTransformer,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

export const THEME = "github-dark-default";

type LangLoader = () => Promise<{ default: LanguageRegistration[] }>;

const LANGS: Record<string, LangLoader> = {
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  csharp: () => import("@shikijs/langs/csharp"),
  css: () => import("@shikijs/langs/css"),
  csv: () => import("@shikijs/langs/csv"),
  diff: () => import("@shikijs/langs/diff"),
  docker: () => import("@shikijs/langs/docker"),
  go: () => import("@shikijs/langs/go"),
  html: () => import("@shikijs/langs/html"),
  ini: () => import("@shikijs/langs/ini"),
  java: () => import("@shikijs/langs/java"),
  javascript: () => import("@shikijs/langs/javascript"),
  json: () => import("@shikijs/langs/json"),
  jsx: () => import("@shikijs/langs/jsx"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  make: () => import("@shikijs/langs/make"),
  markdown: () => import("@shikijs/langs/markdown"),
  php: () => import("@shikijs/langs/php"),
  po: () => import("@shikijs/langs/po"),
  python: () => import("@shikijs/langs/python"),
  ruby: () => import("@shikijs/langs/ruby"),
  rust: () => import("@shikijs/langs/rust"),
  scss: () => import("@shikijs/langs/scss"),
  shellscript: () => import("@shikijs/langs/shellscript"),
  sql: () => import("@shikijs/langs/sql"),
  swift: () => import("@shikijs/langs/swift"),
  toml: () => import("@shikijs/langs/toml"),
  tsx: () => import("@shikijs/langs/tsx"),
  typescript: () => import("@shikijs/langs/typescript"),
  xml: () => import("@shikijs/langs/xml"),
  yaml: () => import("@shikijs/langs/yaml"),
};

const ALIASES: Record<string, string> = {
  bash: "shellscript",
  "c++": "cpp",
  "c#": "csharp",
  htm: "html",
  js: "javascript",
  kt: "kotlin",
  md: "markdown",
  mdoc: "markdown",
  pot: "po",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "shellscript",
  shell: "shellscript",
  ts: "typescript",
  yml: "yaml",
  zsh: "shellscript",
};

/** Unknown ids fall back to plain text rather than failing the block. */
export const resolveLang = (lang: string): string => {
  const id = ALIASES[lang] ?? lang;
  return id in LANGS ? id : "text";
};

let instance: Promise<HighlighterCore> | null = null;

const getHighlighter = (): Promise<HighlighterCore> => {
  instance ??= createHighlighterCore({
    themes: [githubDarkDefault],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return instance;
};

export async function ensureLangs(langs: Iterable<string>): Promise<HighlighterCore> {
  const highlighter = await getHighlighter();
  const loaded = new Set(highlighter.getLoadedLanguages());
  const missing = [...new Set([...langs].map(resolveLang))].filter(
    (id) => id !== "text" && !loaded.has(id),
  );
  const loaders = missing.flatMap((id) => {
    const loader = LANGS[id];
    return loader ? [loader] : [];
  });
  if (loaders.length > 0) await highlighter.loadLanguage(...loaders);
  return highlighter;
}

/**
 * The two per-line marks the code block needs: the change overlay and the
 * author's `mark=` highlight, both addressed by absolute file line.
 */
export const lineMarks = (from: number, changed: number[], mark: number[]): ShikiTransformer => {
  const added = new Set(changed);
  const highlighted = new Set(mark);
  return {
    name: "balade:line-marks",
    line(node, line) {
      const absolute = from + line - 1;
      if (added.has(absolute)) this.addClassToHast(node, "add");
      if (highlighted.has(absolute)) this.addClassToHast(node, "hl");
    },
  };
};

/** Highlighted HTML, or `null` until the grammar has loaded. */
export function useHighlighted(
  code: string,
  lang: string,
  transformers: ShikiTransformer[],
): string | null {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    ensureLangs([lang])
      .then((highlighter) => {
        if (!alive) return;
        setHtml(
          highlighter.codeToHtml(code, {
            lang: resolveLang(lang),
            theme: THEME,
            transformers,
          }),
        );
      })
      .catch(() => {
        if (alive) setHtml(null);
      });
    return () => {
      alive = false;
    };
  }, [code, lang, transformers]);
  return html;
}
