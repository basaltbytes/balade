/** Pure output policy at the interactive generation command boundary. */

import { describe, expect, it } from "@effect/vitest";
import {
  generationSummaryText,
  generationSuccessText,
  makeGenerationProgress,
} from "../src/commands/generate/index.js";
import { sanitizeTerminalText } from "../src/terminal.js";

describe("generation command output", () => {
  it("removes terminal control sequences from untrusted text", () => {
    expect(
      sanitizeTerminalText("safe\u001b]8;;https://evil.invalid\u0007link\u001b]8;;\u0007\u0000"),
    ).toBe("safelink");
  });

  it("summarizes compact progress and gives generate-only runs a next step", () => {
    const output: string[] = [];
    const progress = makeGenerationProgress((value) => output.push(value));

    progress({ _tag: "AuthorToolStarted", name: "list_pr_changes", input: "{}" });
    progress({ _tag: "AuthorToolStarted", name: "search_source", input: "{}" });
    progress({ _tag: "AuthorToolStarted", name: "read_pr_diff", input: "{}" });
    progress({ _tag: "AuthorToolStarted", name: "read_pr_diff", input: "{}" });
    progress({ _tag: "AuthorToolStarted", name: "read_source", input: "{}" });
    progress({ _tag: "AuthorToolStarted", name: "read_source", input: "{}" });
    progress({ _tag: "AuthorToolStarted", name: "read_base_source", input: "{}" });
    progress({ _tag: "AuthorToolStarted", name: "submit_walkthrough", input: "{}" });
    progress({
      _tag: "AuthorUsageUpdated",
      usage: {
        input: 12,
        output: 3,
        cacheRead: 20,
        cacheWrite: 0,
        total: 35,
        cost: 0.0123,
      },
    });

    expect(output).toEqual([
      "Inspecting pull-request changes…\n",
      "Searching pinned source…\n",
      "Reading relevant diffs…\n",
      "Confirming pinned source ranges…\n",
      "Submitting the walkthrough draft…\n",
      "Turn 1: 35 cumulative tokens (in 12, out 3, cache 20/0); cost $0.0123\n",
    ]);
    expect(
      generationSuccessText({
        file: "walkthroughs/pr-20-generate-with-pi.md",
        ranges: 7,
        repairs: 0,
      }),
    ).toBe(
      "Check passed: 7 code ranges verified.\n" +
        "Generated walkthroughs/pr-20-generate-with-pi.md.\n" +
        "Review it with:\n  balade open walkthroughs/pr-20-generate-with-pi.md\n",
    );
    expect(
      generationSummaryText({
        file: "walkthroughs/pr-20-generate-with-pi.md",
        ranges: 7,
        repairs: 1,
      }),
    ).toBe(
      "Check passed after 1 repair turn: 7 code ranges verified.\n" +
        "Generated walkthroughs/pr-20-generate-with-pi.md.\n",
    );
  });

  it("shows model prose and tool details only in verbose progress", () => {
    const output: string[] = [];
    const progress = makeGenerationProgress((value) => output.push(value), "verbose");

    progress({ _tag: "AuthorAssistantText", text: "I found the behavioral spine." });
    progress({
      _tag: "AuthorToolStarted",
      name: "read_source",
      input: '{"path":"src/example.ts","from":1,"to":2}',
    });
    progress({
      _tag: "AuthorToolFinished",
      name: "read_source",
      output: "1 | export const value = 1;",
      failed: false,
    });

    expect(output).toEqual([
      "[assistant]\nI found the behavioral spine.\n",
      '[read_source] {"path":"src/example.ts","from":1,"to":2}\n',
      "1 | export const value = 1;\n",
      "[/read_source]\n",
    ]);
  });
});
