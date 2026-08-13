/**
 * The versioned authoring package identity: version, stamp key, and
 * inspection budgets.
 *
 * The major version matches the walkthrough schema the package teaches.
 * Generated walkthroughs record the full version under
 * `meta.balade-authoring`; the generated skill stamps the same key in its
 * frontmatter, and `balade check` compares that stamp against this version.
 */

export const AUTHORING_PACKAGE_VERSION = "1.20.0";
export const AUTHORING_WALKTHROUGH_SCHEMA_VERSION = 1;
export const AUTHORING_META_KEY = "balade-authoring";

/** `--budget`: how much inspection one authoring session may spend. */
export type InspectionTier = "base" | "x2" | "unlimited";

export interface InspectionBudget {
  readonly diffReads: number;
  readonly searches: number;
  readonly sourceReads: number;
}

/**
 * Budgets exist to guarantee termination, never to economize on the
 * operator's behalf. `base` scales with the changed-file count: every changed
 * file stays readable with paging slack, and source reads keep room for the
 * adjacent files a claim depends on; the floors keep small pull requests free
 * to explore. `x2` doubles that estimate, and `unlimited` removes enforcement
 * entirely — spending is the operator's decision.
 */
export function inspectionBudget(changedFiles: number, tier: InspectionTier): InspectionBudget {
  if (tier === "unlimited") {
    return {
      diffReads: Number.POSITIVE_INFINITY,
      searches: Number.POSITIVE_INFINITY,
      sourceReads: Number.POSITIVE_INFINITY,
    };
  }
  const scale = tier === "x2" ? 2 : 1;
  return {
    diffReads: Math.max(16, changedFiles * 2) * scale,
    searches: Math.max(30, changedFiles * 2) * scale,
    sourceReads: Math.max(24, changedFiles * 3) * scale,
  };
}
