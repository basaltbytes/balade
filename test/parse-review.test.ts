/* The gate both edges share: the CLI reads `.balade/` files and PUT bodies
   through it, the SPA reads localStorage and the served answer. */

import { Effect } from "effect";
import { describe, expect, it } from "@effect/vitest";
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
  it.effect("reads a well-formed state back", () =>
    Effect.gen(function* () {
      expect(yield* parseReviewState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    }),
  );

  it.effect("refuses a corrupt nested mark", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        parseReviewState({
          ...state,
          sections: { ...state.sections, broken: { hash: 7, at: "2026-01-01T09:00:00.000Z" } },
          files: { "intro//x.py": null },
        }),
      );
      expect(error._tag).toBe("ReviewStateInvalid");
    }),
  );

  it.effect("refuses another schema version", () =>
    Effect.gen(function* () {
      expect((yield* Effect.flip(parseReviewState({ ...state, version: 2 })))._tag).toBe(
        "ReviewStateInvalid",
      );
    }),
  );

  it.effect("refuses junk", () =>
    Effect.gen(function* () {
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
        expect((yield* Effect.flip(parseReviewState(junk)))._tag).toBe("ReviewStateInvalid");
      }
    }),
  );
});
