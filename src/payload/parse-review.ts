/**
 * The review-state gate, shared by the CLI server and the SPA.
 *
 * Both sides read the same JSON from an edge — a file under `.balade/`, a PUT
 * body, localStorage — and neither trusts it. The module stays pure so `app/`
 * may import it: no node, no CLI runtime.
 */

import { Schema } from "effect";
import { ReviewState as ReviewStateSchema } from "./schema.js";
import type { ReviewState } from "./types.js";

const decodeReviewState = Schema.decodeUnknownResult(ReviewStateSchema, {
  onExcessProperty: "error",
});

/** A serialized state from any edge: corrupt JSON reads as no state. */
export function parseReviewJson(raw: string): ReviewState | null {
  try {
    return parseReviewState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function parseReviewState(value: unknown): ReviewState | null {
  const decoded = decodeReviewState(value);
  return decoded._tag === "Success" ? decoded.success : null;
}
