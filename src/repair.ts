/** Shared bounded repair loop for model-authored candidates. */

import { Effect, Result } from "effect";

export const repairInvalid = Effect.fn("repairInvalid")(function* <
  Candidate,
  Success,
  Failure,
  EvaluationError,
  EvaluationRequirements,
  RepairError,
  RepairRequirements,
>(options: {
  readonly initial: Candidate;
  readonly evaluate: (
    candidate: Candidate,
  ) => Effect.Effect<Result.Result<Success, Failure>, EvaluationError, EvaluationRequirements>;
  readonly repair: (
    candidate: Candidate,
    failure: Failure,
  ) => Effect.Effect<Candidate, RepairError, RepairRequirements>;
  readonly maxAttempts: number;
  readonly stopAfter?: (previous: Failure, next: Failure) => boolean;
}) {
  let candidate = options.initial;
  let outcome = yield* options.evaluate(candidate);
  let repairs = 0;

  while (Result.isFailure(outcome) && repairs < options.maxAttempts) {
    const previous = outcome.failure;
    repairs += 1;
    candidate = yield* options.repair(candidate, previous);
    outcome = yield* options.evaluate(candidate);
    if (
      Result.isFailure(outcome) &&
      options.stopAfter !== undefined &&
      options.stopAfter(previous, outcome.failure)
    ) {
      break;
    }
  }

  return { candidate, outcome, repairs };
});
