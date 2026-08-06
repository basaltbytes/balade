/**
 * The versioned authoring package identity: version, stamp key, and
 * inspection limits.
 *
 * The major version matches the walkthrough schema the package teaches.
 * Generated walkthroughs record the full version under
 * `meta.balade-authoring`; the generated skill stamps the same key in its
 * frontmatter, and `balade check` compares that stamp against this version.
 */

export const AUTHORING_PACKAGE_VERSION = "1.7.0";
export const AUTHORING_WALKTHROUGH_SCHEMA_VERSION = 1;
export const AUTHORING_META_KEY = "balade-authoring";

export const AUTHORING_LIMITS = {
  diffReads: 8,
  searches: 20,
  sourceReads: 12,
  codeRanges: 10,
  suggestedSections: { minimum: 2, maximum: 5 },
  suggestedCodeRanges: { minimum: 3, maximum: 8 },
} as const;
