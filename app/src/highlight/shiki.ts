/* One shiki instance for the whole app, `github-dark-default` everywhere.
   Fine-grained over a curated grammar map (the trade-off is in DECISIONS.md);
   adding a language is one line in `LANGS` below. */

import githubDarkDefault from "@shikijs/themes/github-dark-default";
import { Context, Effect, Layer, Result, Schema } from "effect";
import {
  createHighlighterCore,
  type HighlighterCore,
  type LanguageRegistration,
  type ShikiTransformer,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

export const THEME = "github-dark-default";
export const MAX_HIGHLIGHT_LINE_CHARS = 2_000;

export function hasOverlongHighlightLine(code: string): boolean {
  let lineStart = 0;
  while (lineStart <= code.length) {
    const lineEnd = code.indexOf("\n", lineStart);
    if ((lineEnd === -1 ? code.length : lineEnd) - lineStart > MAX_HIGHLIGHT_LINE_CHARS)
      return true;
    if (lineEnd === -1) return false;
    lineStart = lineEnd + 1;
  }
  return false;
}

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

/** Oversized lines stay on Shiki's linear plaintext path in diff views. */
export const highlightLanguage = (code: string, lang: string): string =>
  hasOverlongHighlightLine(code) ? "text" : resolveLang(lang);

export class HighlightLoadFailed extends Schema.TaggedErrorClass<HighlightLoadFailed>()(
  "HighlightLoadFailed",
  {
    languages: Schema.Array(Schema.String),
    cause: Schema.Defect(),
  },
) {}

export class HighlightRenderFailed extends Schema.TaggedErrorClass<HighlightRenderFailed>()(
  "HighlightRenderFailed",
  {
    output: Schema.Literals(["html", "ast"]),
    language: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class HighlightLanguageCheckFailed extends Schema.TaggedErrorClass<HighlightLanguageCheckFailed>()(
  "HighlightLanguageCheckFailed",
  {
    language: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export type HighlightFailure =
  | HighlightLoadFailed
  | HighlightRenderFailed
  | HighlightLanguageCheckFailed;

interface SyntaxHighlighterPort {
  readonly ensureLanguages: (
    languages: ReadonlyArray<string>,
  ) => Effect.Effect<HighlighterCore, HighlightLoadFailed>;
}

export class SyntaxHighlighter extends Context.Service<SyntaxHighlighter, SyntaxHighlighterPort>()(
  "@balade/app/SyntaxHighlighter",
) {}

type HighlighterFactory = () => Promise<HighlighterCore>;

/** A layer factory is the real failure-injection seam for the Shiki adapter. */
export const syntaxHighlighterLayer = (create: HighlighterFactory) =>
  Layer.sync(SyntaxHighlighter, () => {
    let highlighterPromise: Promise<HighlighterCore> | null = null;
    const getHighlighter = (): Promise<HighlighterCore> => (highlighterPromise ??= create());

    return {
      ensureLanguages: Effect.fn("SyntaxHighlighter.ensureLanguages")(
        (languages: ReadonlyArray<string>) => {
          const resolved = [...new Set(languages.map(resolveLang))];
          return Effect.tryPromise({
            try: async () => {
              const highlighter = await getHighlighter();
              const loaded = new Set(highlighter.getLoadedLanguages());
              const missing = resolved.filter((id) => id !== "text" && !loaded.has(id));
              const loaders = missing.flatMap((id) => {
                const loader = LANGS[id];
                return loader === undefined ? [] : [loader];
              });
              if (loaders.length > 0) await highlighter.loadLanguage(...loaders);
              return highlighter;
            },
            catch: (cause) => new HighlightLoadFailed({ languages: resolved, cause }),
          });
        },
      ),
    };
  });

export const shikiLayer = syntaxHighlighterLayer(() =>
  createHighlighterCore({
    themes: [githubDarkDefault],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  }),
);

export const ensureLangs = Effect.fn("SyntaxHighlighter.loadLanguages")(function* (
  languages: ReadonlyArray<string>,
) {
  const highlighter = yield* SyntaxHighlighter;
  return yield* highlighter.ensureLanguages(languages);
});

export const renderCodeHtml = Effect.fn("SyntaxHighlighter.renderHtml")((
  highlighter: Pick<HighlighterCore, "codeToHtml">,
  code: string,
  lang: string,
  transformers: ReadonlyArray<ShikiTransformer>,
) => {
  const language = resolveLang(lang);
  return Effect.try({
    try: () =>
      highlighter.codeToHtml(code, {
        lang: language,
        theme: THEME,
        transformers: [...transformers],
      }),
    catch: (cause) => new HighlightRenderFailed({ output: "html", language, cause }),
  });
});

export const highlightCode = Effect.fn("SyntaxHighlighter.highlightCode")(function* (
  code: string,
  lang: string,
  transformers: ReadonlyArray<ShikiTransformer>,
) {
  const highlighter = yield* ensureLangs([lang]);
  return yield* renderCodeHtml(highlighter, code, lang, transformers);
});

export const renderCodeAst = (
  highlighter: Pick<HighlighterCore, "codeToHast">,
  code: string,
  lang: string,
) => {
  const language = highlightLanguage(code, lang);
  return Result.try({
    try: () => highlighter.codeToHast(code, { lang: language, theme: THEME }),
    catch: (cause) => new HighlightRenderFailed({ output: "ast", language, cause }),
  });
};

export const logHighlightFailure = (error: HighlightFailure): Effect.Effect<void> =>
  Effect.logWarning("balade: syntax highlighting failed; using plain text.", error);

export const withHighlightFallback =
  <Fallback>(fallback: Fallback) =>
  <A, E extends HighlightFailure, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A | Fallback, never, R> =>
    effect.pipe(Effect.catch((error) => logHighlightFailure(error).pipe(Effect.as(fallback))));

/**
 * The two per-line marks the code block needs: the change overlay and the
 * author's `mark=` highlight, both addressed by absolute file line.
 */
export const lineMarks = (
  from: number,
  changed: ReadonlyArray<number>,
  mark: ReadonlyArray<number>,
): ShikiTransformer => {
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
