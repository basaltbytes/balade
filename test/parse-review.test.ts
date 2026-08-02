/* The gate both edges share: the CLI reads `.balade/` files and PUT bodies
   through it, the SPA reads localStorage and the served answer. */

import { describe, expect, it } from "vitest";
import { parseReviewState } from "../src/payload/parse-review.js";
import type { ReviewState } from "../src/payload/types.js";

const state: ReviewState = {
  version: 1,
  walkthrough: "walkthroughs/one.md",
  pr: 42,
  stamp: "9f3c2ad",
  sections: { intro: { hash: "sha256:aa", at: "2026-01-01T09:00:00.000Z" } },
  files: { "intro//models/pool.py": { hash: "sha256:bb", at: "2026-01-01T09:01:00.000Z" } },
};

describe("parseReviewState", () => {
  it("reads a well-formed state back", () => {
    expect(parseReviewState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  it("refuses a corrupt nested mark", () => {
    expect(
      parseReviewState({
        ...state,
        sections: { ...state.sections, broken: { hash: 7, at: "2026-01-01T09:00:00.000Z" } },
        files: { "intro//x.py": null },
      }),
    ).toBeNull();
  });

  it("refuses another schema version", () => {
    expect(parseReviewState({ ...state, version: 2 })).toBeNull();
  });

  it("refuses junk", () => {
    for (const junk of [
      null,
      undefined,
      3,
      "state",
      [],
      {},
      { version: 1 },
      { ...state, pr: "42" },
    ]) {
      expect(parseReviewState(junk)).toBeNull();
    }
  });
});
