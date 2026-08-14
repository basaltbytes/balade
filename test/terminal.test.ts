/** Terminal styling: the SGR allowlist at the write edge and themed formatting. */

import { describe, expect, it, vi } from "@effect/vitest";
import { stripVTControlCharacters } from "node:util";
import type { CheckReport } from "../src/contract/types.js";
import {
  formatText,
  sanitizeStyledTerminalText,
  stdoutTheme,
  warningText,
  type Theme,
} from "../src/terminal.js";

/** Marks each slot so a test reads placement, not ANSI bytes. */
const markerTheme: Theme = {
  error: (text) => `<error>${text}</error>`,
  warning: (text) => `<warning>${text}</warning>`,
  ok: (text) => `<ok>${text}</ok>`,
  emphasis: (text) => `<em>${text}</em>`,
  muted: (text) => `<muted>${text}</muted>`,
  url: (text) => `<url>${text}</url>`,
};

const report = (overrides: Partial<CheckReport>): CheckReport => ({
  file: "walkthroughs/one.md",
  ok: true,
  diagnostics: [],
  ranges: [],
  ...overrides,
});

describe("styled write edge", () => {
  it("keeps the theme's own color sequences", () => {
    const styled = "\u001b[1m\u001b[31merror\u001b[39m\u001b[22m plain \u001b[2mdim\u001b[22m";
    expect(sanitizeStyledTerminalText(styled)).toBe(styled);
  });

  it("passes every sequence the live theme emits", () => {
    /* Pins the allowlist to the palette: a slot repainted with a color the
       writers do not admit would otherwise lose its styling silently. */
    vi.stubEnv("FORCE_COLOR", "1");
    try {
      for (const paint of Object.values(stdoutTheme)) {
        const painted = paint("text");
        expect(painted).not.toBe("text");
        expect(sanitizeStyledTerminalText(painted)).toBe(painted);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("strips every control that is not a palette color", () => {
    expect(
      sanitizeStyledTerminalText(
        "a\u001b[8mhidden\u001b[28mb" /* conceal is SGR but not palette */ +
          "\u001b[2Jc" /* clear screen */ +
          "\u001b]8;;https://evil.invalid\u0007link\u001b]8;;\u0007" /* OSC hyperlink */ +
          "\u001b[31mred\u001b[39m" /* palette red survives */,
      ),
    ).toBe("ahiddenbclink\u001b[31mred\u001b[39m");
  });
});

describe("themed check report", () => {
  const failing = report({
    ok: false,
    diagnostics: [
      {
        level: "error",
        code: "expect-mismatch",
        file: "models/pool.py",
        line: 12,
        message: "The expected line differs.",
        expected: "class Pool",
        actual: "class PoolItem",
        hint: "Align expect= with the pinned source.",
      },
    ],
    ranges: [{ file: "models/pool.py", from: 1, to: 2, firstLine: "first", lastLine: "last" }],
  });

  it("stays plain without a theme, for pipes and the repair prompt", () => {
    const text = formatText({ reports: [failing] });
    expect(text).toBe(stripVTControlCharacters(text));
    expect(text).not.toContain("<");
  });

  it("paints marks, labels, and the verdict — never the untrusted values", () => {
    const text = formatText({ reports: [failing] }, markerTheme);
    expect(text).toContain("<em>walkthroughs/one.md</em>");
    expect(text).toContain("<error>error  </error> expect-mismatch");
    expect(text).toContain("<muted>expected</muted>  class Pool");
    expect(text).toContain("<muted>fix</muted>       Align expect= with the pinned source.");
    expect(text).toContain("<error>failed —</error> 1 error");
    expect(text).not.toContain("<em>class");
  });

  it("strips controls inside untrusted fields before painting", () => {
    const hostile = report({
      ok: false,
      diagnostics: [
        {
          level: "error",
          code: "expect-mismatch",
          file: "models/pool.py",
          message: "hidden \u001b[32mok\u001b[39m mark",
        },
      ],
    });
    expect(formatText({ reports: [hostile] }, markerTheme)).toContain("hidden ok mark");
  });

  it("paints the multi-report verdict by outcome", () => {
    const pass = formatText({ reports: [report({}), report({ file: "b.md" })] }, markerTheme);
    expect(pass).toContain("<ok>2 walkthroughs pass.</ok>");
    const fail = formatText(
      { reports: [report({}), report({ file: "b.md", ok: false })] },
      markerTheme,
    );
    expect(fail).toContain("<error>1 of 2 walkthroughs fail.</error>");
  });
});

describe("warning shape", () => {
  it("keeps the three-line mark, message, fix form", () => {
    expect(
      warningText({
        code: "walkthrough-exists",
        message: "PR 7 already has one.",
        hint: "Pass --force.",
      }),
    ).toBe("warning walkthrough-exists\n  PR 7 already has one.\n  fix Pass --force.\n");
  });

  it("paints the mark and fix label only", () => {
    const text = warningText(
      { code: "walkthrough-exists", message: "PR 7 already has one.", hint: "Pass --force." },
      markerTheme,
    );
    expect(text).toContain("<warning>warning</warning> walkthrough-exists");
    expect(text).toContain("<muted>fix</muted> Pass --force.");
  });
});
