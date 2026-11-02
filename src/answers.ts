/** Portable clarification entry: decoded payloads, no Node services or agent runtime. */
import { Effect } from "effect";
import {
  checkAnswerEffect,
  type AnswerCheckResult,
  type PayloadAnswerSource,
} from "./walkthrough/answer.js";

export { checkAnswerEffect } from "./walkthrough/answer.js";
export type { AnswerCheckResult, PayloadAnswerSource } from "./walkthrough/answer.js";
export { clarificationContext } from "./clarification.js";
export type { ClarificationContextOptions, ClarificationWalkthrough } from "./clarification.js";

export function checkAnswer(body: string, source: PayloadAnswerSource): Promise<AnswerCheckResult> {
  return Effect.runPromise(checkAnswerEffect(body, source));
}
