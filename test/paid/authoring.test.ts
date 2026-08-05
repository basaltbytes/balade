/** Paid authoring comparison. Run only through `pnpm eval:authoring:paid`. */

import { Effect, Layer, Schema } from "effect";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "@effect/vitest";
import { AUTHORING_PACKAGE_VERSION } from "../../src/pi/authoring.js";
import { contextResolverLive } from "../../src/git/git.js";
import { piWalkthroughAuthorLive } from "../../src/pi/client.js";
import { runGeneration } from "../../src/commands/generate/run.js";
import { shellLayer } from "../support/effect.js";
import { AUTHORING_EVAL_CASES } from "../fixtures/authoring.js";
import {
  authoringDecisionFailures,
  createAuthoringFixtureRepo,
  selectAuthorModel,
} from "../support/authoring.js";

const PaidEvalConfig = Schema.Struct({
  providerId: Schema.NonEmptyString,
  modelId: Schema.NonEmptyString,
});

const readPaidEvalConfig = Schema.decodeUnknownEffect(PaidEvalConfig, {
  onExcessProperty: "error",
})({
  providerId: process.env["BALADE_EVAL_PROVIDER"],
  modelId: process.env["BALADE_EVAL_MODEL"],
});

const paidLayer = Layer.mergeAll(piWalkthroughAuthorLive, contextResolverLive).pipe(
  Layer.provideMerge(shellLayer),
);

describe(`authoring package ${AUTHORING_PACKAGE_VERSION} paid evaluation`, () => {
  for (const fixture of AUTHORING_EVAL_CASES) {
    it.live(`${fixture.id}: ${fixture.expected.decision}`, () =>
      Effect.acquireRelease(
        Effect.sync(() => createAuthoringFixtureRepo(fixture)),
        (repo) => Effect.sync(repo.cleanup),
      ).pipe(
        Effect.flatMap((repo) =>
          Effect.gen(function* () {
            const config = yield* readPaidEvalConfig;
            const model = yield* selectAuthorModel(config.providerId, config.modelId);
            const result = yield* runGeneration({
              source: repo.source,
              model,
              directory: "walkthroughs",
              progressMode: "compact",
              progress: () => {},
            });
            const output = readFileSync(result.file, "utf8");

            expect(result.report.diagnostics).toEqual([]);
            expect(result._tag).toBe("Generated");
            expect(
              authoringDecisionFailures(output, fixture.expected, { checkPhrases: false }),
            ).toEqual([]);
          }),
        ),
        Effect.provide(paidLayer),
      ),
    );
  }
});
