/** Pure output policy at the interactive generation command boundary. */

import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import {
  generationPreflightText,
  generationSiblingText,
  generationSummaryText,
  generationSuccessText,
  makeGenerationProgress,
} from "../src/commands/generate/index.js";
import { generateErrorMessage } from "../src/commands/generate/pipeline.js";
import {
  ExistingDifferentHead,
  ExistingSameHead,
  ExistingStampInvalid,
  ExistingStampUnreadable,
  OutputAlreadyExists,
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
      "warning head-instructions-skipped\n" +
        '  Skipped "AGENTS.md" because this pull request changes it.\n' +
        '  fix Review "AGENTS.md", then pass --trust-head-instructions to apply it during generation.\n',
      "Inspecting pull-request changes…\n",
      "Searching pinned source…\n",
      "Reading relevant diffs…\n",
      "Confirming pinned source ranges…\n",
      "Submitting the walkthrough draft…\n",
      "Turn 1: 35 cumulative tokens (in 12, out 3, cache 20/0); cumulative cost $0.0123\n",
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

  it("explains preflight matches and post-write siblings", () => {
    expect(generationPreflightText(100, ["walkthroughs/pr-100-existing.md"])).toContain(
      "this run may choose the same filename",
    );
    expect(
      generationSiblingText(100, ["walkthroughs/pr-100-en.md", "walkthroughs/pr-100-fr.md"]),
    ).toContain("Other walkthroughs for PR 100");
  });

  it("distinguishes collision stamps while always naming the retained draft", () => {
    const base = {
      file: "/repo/walkthroughs/pr-100-review.md",
      retainedFile: "/repo/walkthroughs/pr-100-review-recovered-123.md",
      currentHead: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    } as const;
    const messages = [
      generateErrorMessage(new OutputAlreadyExists({ ...base, existing: new ExistingSameHead() })),
      generateErrorMessage(
        new OutputAlreadyExists({
          ...base,
          existing: new ExistingDifferentHead({
            pin: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          }),
        }),
      ),
      generateErrorMessage(
        new OutputAlreadyExists({ ...base, existing: new ExistingStampInvalid() }),
      ),
      generateErrorMessage(
        new OutputAlreadyExists({
          ...base,
          existing: new ExistingStampUnreadable({
            reason: "PermissionDenied",
            cause: new Error("private detail"),
          }),
        }),
      ),
    ];

    expect(messages[0]).toContain("same head");
    expect(messages[1]).toContain("stamped aaaaaaa");
    expect(messages[1]).toContain("head is now bbbbbbb");
    expect(messages[2]).toContain("without a readable walkthrough stamp");
    expect(messages[3]).toContain("PermissionDenied");
    for (const message of messages) expect(message).toContain(base.retainedFile);
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
