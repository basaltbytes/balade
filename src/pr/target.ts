/**
 * What `open` was pointed at. A pull-request reference — a GitHub URL, `#96`,
 * or bare digits — names its walkthroughs instead of a path; a URL also pins
 * the `owner/name` the repository must match. Parsing is pure; the git
 * questions belong to the locator.
 */

export interface PrTarget {
  number: number;
  /** `owner/name` when the reference carries it (a URL), else `null`. */
  slug: string | null;
}

export type OpenTarget =
  | { kind: "files"; paths: readonly string[] }
  | { kind: "discovered" }
  | { kind: "pr"; pr: PrTarget }
  | { kind: "invalid"; message: string };

const PR_URL = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/;
const PR_SHORT = /^#?(\d+)$/;

/** A single argument read as a PR reference, or `null` when it is a path. */
export function parsePrTarget(argument: string): PrTarget | null {
  const url = PR_URL.exec(argument);
  if (url !== null && url[1] !== undefined && url[2] !== undefined && url[3] !== undefined) {
    return { number: Number(url[3]), slug: `${url[1]}/${url[2]}` };
  }
  const short = PR_SHORT.exec(argument);
  if (short !== null && short[1] !== undefined) {
    return { number: Number(short[1]), slug: null };
  }
  return null;
}

/** How `open` reads its positional arguments: paths, a PR reference, or nothing. */
export function parseOpenTarget(argv: readonly string[]): OpenTarget {
  if (argv.length === 0) return { kind: "discovered" };
  const references = argv.map(parsePrTarget).filter((target) => target !== null);
  if (references.length === 0) return { kind: "files", paths: argv };
  const first = references[0];
  if (argv.length > 1 || first === undefined) {
    return {
      kind: "invalid",
      message: "Serve one pull request at a time, on its own: `balade open <pr-url>`.",
    };
  }
  return { kind: "pr", pr: first };
}
