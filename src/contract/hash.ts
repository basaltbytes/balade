import { createHash } from "node:crypto";

/** Content hashes are the review-state reset key; the prefix ships with the value. */
export function sha256(input: string): string {
  return `sha256:${createHash("sha256").update(input, "utf8").digest("hex")}`;
}
