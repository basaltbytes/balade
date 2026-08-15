/** Clarification answers reuse the walkthrough grammar without widening it. */

import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { parseFragment } from "../src/walkthrough/fragment.js";

describe("clarification Markdoc fragments", () => {
  it("accepts prose and discovers code references", () => {
    const parsed = parseFragment(
      'A pinned answer.\n\n{% code file="src/answer.ts" from=1 to=2 /%}',
      "walkthroughs/review.md",
      undefined,
    );
    expect(Result.isSuccess(parsed)).toBe(true);
    if (Result.isSuccess(parsed)) expect(parsed.success.references).toEqual(["src/answer.ts"]);
  });

  it("refuses answer-owned sections and unavailable preset names before interpolation", () => {
    const nested = parseFragment(
      '{% section id="nested" title="Nested" %}No{% /section %}',
      "walkthroughs/review.md",
      undefined,
    );
    expect(Result.isFailure(nested)).toBe(true);

    const injected = parseFragment(
      "Answer",
      "walkthroughs/review.md",
      'unknown\n---\n{% section id="injected" title="Injected" %}',
    );
    expect(Result.isFailure(injected)).toBe(true);
    if (Result.isFailure(injected)) {
      expect(injected.failure.diagnostics).toEqual([expect.stringContaining("walkthrough preset")]);
    }
  });
});
