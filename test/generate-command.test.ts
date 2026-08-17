/** Pure output policy at the interactive generation command boundary. */

import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import {
  generationBlockedMessage,
  generationRefreshText,
  generationReplaceQuestion,
  generationSiblingText,
  generationSummaryText,
  generationSuccessText,
  generationSupersededText,
} from "../src/commands/generate/index.js";
import { generateErrorMessage } from "../src/commands/generate/pipeline.js";
import { makeGenerationProgressReporter } from "../src/commands/generate/progress.js";
import { makeGenerationProgress } from "../src/commands/generate/progress-terminal.js";
import type {
  ExistingWalkthrough,
  RefreshingWalkthrough,
} from "../src/commands/generate/output.js";
import {
  AuthorModelId,
  AuthorModelUnavailable,
  AuthorProviderId,
  AuthorRuntimeLoadFailed,
  AuthorSearchConfigurationFailed,
  AuthorSessionStartFailed,
} from "../src/pi/author.js";
import {
  SnapshotOpenFailed,
  SnapshotPathRejected,
  SnapshotReadFailed,
} from "../src/pi/snapshot.js";
import { sanitizeTerminalText } from "../src/terminal.js";

describe("generation command output", () => {
  it("removes terminal control sequences from untrusted text", () => {
    expect(
      sanitizeTerminalText("safe\u001b]8;;https://evil.invalid\u0007link\u001b]8;;\u0007\u0000"),
    ).toBe("safelink");
  });

  it("summarizes compact progress with cumulative cost and gives generate-only runs a next step", () => {
    const output: string[] = [];
    const progress = makeGenerationProgress((value) => output.push(value));

    progress({
      _tag: "AuthorNotice",
      code: "head-instructions-skipped",
      message: 'Skipped "AGENTS.md" because this pull request changes it.',
      hint: 'Review "AGENTS.md", then pass --trust-head-instructions to apply it during generation.',
    });
    progress({ _tag: "GenerationStatusChanged", status: { _tag: "PreparingGeneration" } });
    progress({
      _tag: "GenerationStatusChanged",
      status: { _tag: "AuthoringGeneration", turn: 1 },
    });
    for (const name of [
      "list_pr_changes",
      "search_source",
      "read_pr_diff",
      "read_source",
      "submit_walkthrough",
    ]) {
      progress({
        _tag: "GenerationStatusChanged",
        status: { _tag: "RunningAuthorTool", turn: 1, name },
      });
      progress({
        _tag: "GenerationStatusChanged",
        status: { _tag: "AuthoringGeneration", turn: 1 },
      });
    }
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
      "warning head-instructions-skipped\n" +
        '  Skipped "AGENTS.md" because this pull request changes it.\n' +
        '  fix Review "AGENTS.md", then pass --trust-head-instructions to apply it during generation.\n',
      "Preparing the authoring session…\n",
      "Authoring the walkthrough (turn 1)…\n",
      "Inspecting pull-request changes…\n",
      "Authoring the walkthrough (turn 1)…\n",
      "Searching pinned source…\n",
      "Authoring the walkthrough (turn 1)…\n",
      "Reading relevant diffs…\n",
      "Authoring the walkthrough (turn 1)…\n",
      "Confirming pinned source ranges…\n",
      "Authoring the walkthrough (turn 1)…\n",
      "Submitting the walkthrough draft…\n",
      "Authoring the walkthrough (turn 1)…\n",
      "Turn 1: 35 cumulative tokens (in 12, out 3, cache 20/0); cumulative cost $0.0123\n",
    ]);
    expect(
      generationSuccessText({
        file: "walkthroughs/pr-20-generate-with-pi.md",
        ranges: 7,
        repairs: 0,
        timing: {
          totalMilliseconds: 65_000,
          segments: [
            { _tag: "PreparationTiming", milliseconds: 1_000 },
            { _tag: "AuthorTurnTiming", turn: 1, milliseconds: 60_000 },
            { _tag: "CheckTiming", pass: 1, milliseconds: 4_000 },
          ],
        },
      }),
    ).toBe(
      "Check passed: 7 code ranges verified.\n" +
        "Elapsed 1m05s total (preparation 1s, turn 1 1m00s, check 1 4s).\n" +
        "Generated walkthroughs/pr-20-generate-with-pi.md.\n" +
        "Review it with:\n  balade open walkthroughs/pr-20-generate-with-pi.md\n",
    );
    expect(
      generationSummaryText({
        file: "walkthroughs/pr-20-generate-with-pi.md",
        ranges: 7,
        repairs: 1,
        timing: {
          totalMilliseconds: 83_000,
          segments: [
            { _tag: "PreparationTiming", milliseconds: 2_000 },
            { _tag: "AuthorTurnTiming", turn: 1, milliseconds: 60_000 },
            { _tag: "CheckTiming", pass: 1, milliseconds: 8_000 },
            { _tag: "AuthorTurnTiming", turn: 2, milliseconds: 11_000 },
            { _tag: "CheckTiming", pass: 2, milliseconds: 2_000 },
          ],
        },
      }),
    ).toBe(
      "Check passed after 1 repair turn: 7 code ranges verified.\n" +
        "Elapsed 1m23s total (preparation 2s, turn 1 1m00s, check 1 8s, turn 2 11s, check 2 2s).\n" +
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

  it("owns status transitions and accumulates tools into their authoring turn", () => {
    let now = 0;
    const events: string[] = [];
    const reporter = makeGenerationProgressReporter(
      (event) => events.push(event._tag),
      () => now,
    );

    now = 2_000;
    reporter.author({
      _tag: "AuthorStatusChanged",
      status: { _tag: "AuthorGenerating" },
    });
    now = 5_000;
    reporter.author({
      _tag: "AuthorStatusChanged",
      status: { _tag: "AuthorUsingTool", name: "read_source" },
    });
    now = 7_000;
    reporter.author({
      _tag: "AuthorStatusChanged",
      status: { _tag: "AuthorGenerating" },
    });
    now = 10_000;
    reporter.checking(1);
    now = 12_000;
    reporter.repairing(1, 2);
    reporter.author({
      _tag: "AuthorStatusChanged",
      status: { _tag: "AuthorGenerating" },
    });
    now = 15_000;
    reporter.author({
      _tag: "AuthorStatusChanged",
      status: { _tag: "AuthorUsingTool", name: "submit_walkthrough" },
    });
    now = 18_000;
    reporter.author({
      _tag: "AuthorStatusChanged",
      status: { _tag: "AuthorGenerating" },
    });
    now = 20_000;
    reporter.checking(2);
    now = 21_000;

    expect(reporter.finish()).toEqual({
      totalMilliseconds: 21_000,
      segments: [
        { _tag: "PreparationTiming", milliseconds: 2_000 },
        { _tag: "AuthorTurnTiming", turn: 1, milliseconds: 8_000 },
        { _tag: "CheckTiming", pass: 1, milliseconds: 2_000 },
        { _tag: "AuthorTurnTiming", turn: 2, milliseconds: 8_000 },
        { _tag: "CheckTiming", pass: 2, milliseconds: 1_000 },
      ],
    });
    expect(events).toEqual(Array.from({ length: 9 }, () => "GenerationStatusChanged"));
  });

  it("resolves the overwrite decision in pre-flight prose, never a paid re-run", () => {
    const stale: RefreshingWalkthrough = {
      file: "/repo/walkthroughs/pr-100-review.md",
      relativeFile: "walkthroughs/pr-100-review.md",
      stamp: { _tag: "Stamped", pin: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", lang: "en" },
    };
    const current: ExistingWalkthrough = {
      ...stale,
      stamp: { _tag: "Stamped", pin: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", lang: "en" },
    };
    const unstamped: ExistingWalkthrough = {
      file: "/repo/walkthroughs/pr-100-notes.md",
      relativeFile: "walkthroughs/pr-100-notes.md",
      stamp: { _tag: "Unstamped" },
    };
    const head = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    expect(generationRefreshText([stale], head)).toBe(
      "Refreshing walkthroughs/pr-100-review.md (aaaaaaa → bbbbbbb).\n",
    );
    expect(generationReplaceQuestion([current])).toBe(
      "Replace walkthroughs/pr-100-review.md (already stamped at the current head)? Pass --dir instead to keep both.",
    );
    expect(generationReplaceQuestion([unstamped])).toContain(
      "missing a readable walkthrough stamp",
    );
    expect(generationBlockedMessage([current])).toBe(
      "walkthroughs/pr-100-review.md is already stamped at the current head. " +
        "Re-run with --force to replace it, or use --dir to redirect the output.",
    );
    expect(generationBlockedMessage([unstamped])).toContain("missing a readable walkthrough stamp");
    expect(generationBlockedMessage([current, unstamped])).toContain("--force");
  });

  it("reports supersessions and post-write siblings", () => {
    expect(
      generationSupersededText(
        [
          { file: "walkthroughs/pr-100-review.md" },
          {
            file: "walkthroughs/pr-100-notes.md",
            retainedAt: "walkthroughs/pr-100-notes.md.superseded",
          },
        ],
        "walkthroughs/pr-100-review.md",
      ),
    ).toBe(
      "Superseded walkthroughs/pr-100-notes.md; its uncommitted content is kept at " +
        "walkthroughs/pr-100-notes.md.superseded.\n",
    );
    expect(
      generationSupersededText(
        [{ file: "walkthroughs/pr-100-earlier.md" }],
        "walkthroughs/pr-100-review.md",
      ),
    ).toBe("Superseded walkthroughs/pr-100-earlier.md.\n");
    expect(
      generationSiblingText(100, ["walkthroughs/pr-100-en.md", "walkthroughs/pr-100-fr.md"]),
    ).toContain("Other walkthroughs for PR 100");
  });

  it("gives each startup failure an action-specific message", () => {
    const provider = Schema.decodeUnknownSync(AuthorProviderId)("faux");
    const model = Schema.decodeUnknownSync(AuthorModelId)("faux-model");

    expect([
      generateErrorMessage(new AuthorRuntimeLoadFailed({ cause: new Error("load") })),
      generateErrorMessage(new AuthorModelUnavailable({ provider, model })),
      generateErrorMessage(
        new SnapshotOpenFailed({
          repositoryRoot: "/repo",
          pin: "abc123",
          cause: new Error("snapshot"),
        }),
      ),
      generateErrorMessage(
        new SnapshotReadFailed({
          path: "AGENTS.md",
          cause: new Error("read"),
        }),
      ),
      generateErrorMessage(
        new SnapshotPathRejected({
          path: "AGENTS.md",
          reason: "The path escapes the pinned snapshot.",
        }),
      ),
      generateErrorMessage(
        new AuthorSearchConfigurationFailed({
          file: "/cache/ripgrep.conf",
          cause: new Error("write"),
        }),
      ),
      generateErrorMessage(
        new AuthorSessionStartFailed({
          provider,
          model,
          cause: new Error("session"),
        }),
      ),
    ]).toEqual([
      "Could not load the authoring runtime. Check the balade installation and authoring-state permissions, then retry.",
      "faux/faux-model is no longer available. Select an available model and try again.",
      "Could not prepare pinned source abc123 from /repo. Check repository and snapshot-cache permissions, then retry.",
      "Could not read AGENTS.md from the pinned source. Verify the repository state and retry.",
      "Refused pinned source path AGENTS.md: The path escapes the pinned snapshot.",
      "Could not configure pinned-source search at /cache/ripgrep.conf. Check snapshot-cache permissions, then retry.",
      "Could not start faux/faux-model. Check provider setup and authentication, then retry.",
    ]);
  });
});
