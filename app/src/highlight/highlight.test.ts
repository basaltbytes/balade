import { Effect } from "effect";
import { describe, expect, it } from "@effect/vitest";
import type { HighlighterCore } from "shiki/core";
import { createDiffHighlighter } from "./diff-highlighter";
import {
  ensureLangs,
  highlightLanguage,
  MAX_HIGHLIGHT_LINE_CHARS,
  renderCodeHtml,
  resolveLang,
  shikiLayer,
  syntaxHighlighterLayer,
} from "./shiki";

describe("syntax-highlighting input bounds", () => {
  it("routes a block with an oversized line through plaintext", () => {
    expect(highlightLanguage("<".repeat(MAX_HIGHLIGHT_LINE_CHARS + 1), "shellscript")).toBe("text");
    expect(highlightLanguage("echo safe", "shellscript")).toBe("shellscript");
  });

  it.effect("keeps plaintext and curated diff grammars on the Shiki path", () =>
    Effect.gen(function* () {
      const highlighter = createDiffHighlighter(yield* ensureLangs(["csv", "po"]), () => undefined);

      expect(resolveLang("unknown-attacker-language")).toBe("text");
      expect(highlighter.hasRegisteredCurrentLang("unknown-attacker-language")).toBe(true);
      expect(highlighter.hasRegisteredCurrentLang("csv")).toBe(true);
      expect(highlighter.hasRegisteredCurrentLang("po")).toBe(true);
    }).pipe(Effect.provide(shikiLayer)),
  );

  it.effect("keeps highlighter initialization failures typed", () => {
    const cause = new Error("grammar chunk unavailable");
    return Effect.gen(function* () {
      const error = yield* ensureLangs(["typescript"]).pipe(Effect.flip);

      expect(error._tag).toBe("HighlightLoadFailed");
      expect(error.languages).toEqual(["typescript"]);
      expect(error.cause).toBe(cause);
    }).pipe(Effect.provide(syntaxHighlighterLayer(() => Promise.reject(cause))));
  });

  it.effect("keeps synchronous HTML rendering failures typed", () => {
    const cause = new Error("tokenizer failed");
    const highlighter = {
      codeToHtml: () => {
        throw cause;
      },
    } satisfies Pick<HighlighterCore, "codeToHtml">;

    return Effect.gen(function* () {
      const error = yield* renderCodeHtml(highlighter, "const answer = 42", "typescript", []).pipe(
        Effect.flip,
      );

      expect(error._tag).toBe("HighlightRenderFailed");
      expect(error.output).toBe("html");
      expect(error.language).toBe("typescript");
      expect(error.cause).toBe(cause);
    });
  });

  it("falls back to a plaintext AST when synchronous diff rendering fails", () => {
    const cause = new Error("tokenizer failed");
    const failures: unknown[] = [];
    const highlighter = {
      getLoadedLanguages: () => ["typescript"],
      codeToHast: () => {
        throw cause;
      },
    } satisfies Pick<HighlighterCore, "codeToHast" | "getLoadedLanguages">;
    const adapter = createDiffHighlighter(highlighter, (error) => failures.push(error));

    const processed = adapter.processAST(
      adapter.getAST("const answer = 42", "answer.ts", "typescript"),
    );

    expect(processed.syntaxFileObject[1]?.value).toBe("const answer = 42");
    expect(failures).toMatchObject([
      { _tag: "HighlightRenderFailed", output: "ast", language: "typescript", cause },
    ]);
  });

  it("keeps a registry failure away from the diff library's automatic fallback", () => {
    const cause = new Error("registry failed");
    const failures: unknown[] = [];
    const highlighter = {
      getLoadedLanguages: () => {
        throw cause;
      },
      codeToHast: () => {
        throw new Error("Shiki must stay unused after a registry failure");
      },
    } satisfies Pick<HighlighterCore, "codeToHast" | "getLoadedLanguages">;
    const adapter = createDiffHighlighter(highlighter, (error) => failures.push(error));

    expect(adapter.hasRegisteredCurrentLang("typescript")).toBe(true);
    const processed = adapter.processAST(
      adapter.getAST("const answer = 42", "answer.ts", "typescript"),
    );

    expect(processed.syntaxFileObject[1]?.value).toBe("const answer = 42");
    expect(failures).toMatchObject([
      { _tag: "HighlightLanguageCheckFailed", language: "typescript", cause },
    ]);
  });
});
