import { describe, expect, it } from "vitest";
import { createDiffHighlighter } from "./diff-highlighter";
import { ensureLangs, highlightLanguage, MAX_HIGHLIGHT_LINE_CHARS, resolveLang } from "./shiki";

describe("syntax-highlighting input bounds", () => {
  it("routes a block with an oversized line through plaintext", () => {
    expect(highlightLanguage("<".repeat(MAX_HIGHLIGHT_LINE_CHARS + 1), "shellscript")).toBe("text");
    expect(highlightLanguage("echo safe", "shellscript")).toBe("shellscript");
  });

  it("keeps plaintext and curated diff grammars on the Shiki path", async () => {
    const highlighter = createDiffHighlighter(await ensureLangs(["csv", "po"]));

    expect(resolveLang("unknown-attacker-language")).toBe("text");
    expect(highlighter.hasRegisteredCurrentLang("unknown-attacker-language")).toBe(true);
    expect(highlighter.hasRegisteredCurrentLang("csv")).toBe(true);
    expect(highlighter.hasRegisteredCurrentLang("po")).toBe(true);
  });
});
