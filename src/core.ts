/** The `@balade/core` entry: the payload contract and the portable answer check. No Node built-ins or agent runtime. */
import { Effect } from "effect";
import {
  checkAnswerEffect,
  type AnswerCheckResult,
  type PayloadAnswerSource,
} from "./walkthrough/answer.js";

export * from "./contract/payload.js";
export { checkAnswerEffect } from "./walkthrough/answer.js";
export type { AnswerCheckResult, PayloadAnswerSource } from "./walkthrough/answer.js";
export { clarificationContext } from "./clarification.js";
export type { ClarificationContextOptions, ClarificationWalkthrough } from "./clarification.js";

export function checkAnswer(body: string, source: PayloadAnswerSource): Promise<AnswerCheckResult> {
  return Effect.runPromise(checkAnswerEffect(body, source));
}
