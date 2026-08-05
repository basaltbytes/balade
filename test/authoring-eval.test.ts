/** Stable offline comparisons for authoring prompt revisions. */

import { Effect } from "effect";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { AUTHORING_META_KEY, AUTHORING_PACKAGE_VERSION } from "../src/pi/authoring.js";
import { runGeneration } from "../src/generate/run.js";
import { AUTHORING_EVAL_CASES } from "./fixtures/authoring.js";
import {
  authoringDecisionFailures,
  createAuthoringFauxHarness,
  createAuthoringFixtureRepo,
  fauxAuthorModel,
} from "./support/authoring.js";

describe(`authoring package ${AUTHORING_PACKAGE_VERSION} offline evaluation`, () => {
  for (const fixture of AUTHORING_EVAL_CASES) {
    it.effect(`${fixture.id}: ${fixture.expected.decision}`, () =>
      Effect.acquireRelease(
        Effect.sync(() => createAuthoringFixtureRepo(fixture)),
        (repo) => Effect.sync(repo.cleanup),
      ).pipe(
        Effect.flatMap((repo) =>
          Effect.gen(function* () {
            const harness = yield* Effect.promise(() =>
              createAuthoringFauxHarness(
                fixture.transcript,
                join(repo.directory, ".snapshot-cache"),
              ),
            );
            const result = yield* Effect.gen(function* () {
              const model = yield* fauxAuthorModel();
              return yield* runGeneration({
                source: repo.source,
                model,
                directory: "walkthroughs",
                progressMode: "compact",
                progress: () => {},
              });
            }).pipe(Effect.provide(harness.layer));
            const output = readFileSync(result.file, "utf8");

            expect(result.report.diagnostics).toEqual([]);
            expect(result.report.ok).toBe(true);
            expect(result._tag).toBe("Generated");
            expect(result.repairs).toBe(0);
            expect(output).toContain(`${AUTHORING_META_KEY}: ${AUTHORING_PACKAGE_VERSION}`);
            expect(authoringDecisionFailures(output, fixture.expected)).toEqual([]);
          }),
        ),
      ),
    );
  }
});
