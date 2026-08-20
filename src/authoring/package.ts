/**
 * The versioned authoring package identity: version, stamp key, and
 * inspection budgets.
 *
 * The major version matches the walkthrough schema the package teaches.
 * Generated walkthroughs record the full version under
 * `meta.balade-authoring`; the generated skill stamps the same key in its
 * frontmatter, and `balade check` compares that stamp against this version.
 */

export const AUTHORING_PACKAGE_VERSION = "1.29.0";
export const AUTHORING_WALKTHROUGH_SCHEMA_VERSION = 1;
export const AUTHORING_META_KEY = "balade-authoring";

/** `--budget`: how much inspection one authoring session may spend. */
export type InspectionTier = "low" | "medium" | "high";

export interface InspectionBudget {
  readonly diffReads: number;
  readonly searches: number;
  readonly sourceReads: number;
}

/**
 * Budgets exist to guarantee termination, never to economize on the
 * operator's behalf — unless the operator asks. `medium`, the default, scales
 * with the changed-file count: every changed file stays readable with paging
 * slack, and source reads keep room for the adjacent files a claim depends
 * on; the floors keep small pull requests free to explore. `low` is the
 * operator's explicit economy: one read of each kind per changed file — no
 * paging or adjacent-file slack — floored at the fixed caps balade shipped
 * before scaled budgets, enough to still produce a walkthrough on a
 * constrained spend. `high` removes enforcement entirely.
 */
export function inspectionBudget(changedFiles: number, tier: InspectionTier): InspectionBudget {
  switch (tier) {
    case "high":
      return {
        diffReads: Number.POSITIVE_INFINITY,
        searches: Number.POSITIVE_INFINITY,
        sourceReads: Number.POSITIVE_INFINITY,
      };
    case "low":
      return {
        diffReads: Math.max(8, changedFiles),
        searches: Math.max(20, changedFiles),
        sourceReads: Math.max(12, changedFiles),
      };
    case "medium":
      return {
        diffReads: Math.max(16, changedFiles * 2),
        searches: Math.max(30, changedFiles * 2),
        sourceReads: Math.max(24, changedFiles * 3),
      };
  }
}
