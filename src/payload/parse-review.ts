/**
 * The review-state gate, shared by the CLI server and the SPA.
 *
 * Both sides read the same JSON from an edge — a file under `.balade/`, a PUT
 * body, localStorage — and neither trusts it. The module stays pure so `app/`
 * may import it: no node, no CLI runtime.
 */

import type { ReviewMark, ReviewState } from "./types.js";

/** The one record guard for both packages — every other module imports it from here. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Marks that fail the shape are dropped: one corrupt entry never costs the rest. */
function parseMarks(value: unknown): Record<string, ReviewMark> {
  const marks: Record<string, ReviewMark> = {};
  if (!isRecord(value)) return marks;
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;
    const { hash, at } = entry;
    if (typeof hash === "string" && typeof at === "string") marks[key] = { hash, at };
  }
  return marks;
}

/** A serialized state from any edge: corrupt JSON reads as no state. */
export function parseReviewJson(raw: string): ReviewState | null {
  try {
    return parseReviewState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function parseReviewState(value: unknown): ReviewState | null {
  if (!isRecord(value)) return null;
  const { version, walkthrough, stamp, pr } = value;
  if (version !== 1) return null;
  if (typeof walkthrough !== "string" || typeof stamp !== "string" || typeof pr !== "number") {
    return null;
  }
  return {
    version: 1,
    walkthrough,
    pr,
    stamp,
    sections: parseMarks(value["sections"]),
    files: parseMarks(value["files"]),
  };
}
