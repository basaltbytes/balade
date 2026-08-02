/**
 * Discovery: git-tracked files matching `**‍/walkthroughs/*.md` whose
 * frontmatter carries the `walkthrough` key. Tracked-only keeps the scan
 * bounded and works the same at the repo root and per package in a monorepo.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gitOut, gitToplevel } from "../resolve/exec.js";
import { frontmatterBlock } from "../schema/frontmatter.js";

const WALKTHROUGH_PATH = /(?:^|\/)walkthroughs\/[^/]+\.md$/;

/** What every command says when discovery comes back empty. */
export const NO_WALKTHROUGH =
  "No walkthrough found. A walkthrough is a git-tracked `**/walkthroughs/*.md` file whose frontmatter holds the `walkthrough` key.";

export const NOT_A_REPO =
  "Not inside a git repository — run balade from the repository that holds the walkthrough.";

export interface Discovery {
  repoRoot: string | null;
  /** Repo-relative paths, sorted. */
  paths: string[];
}

export function discoverWalkthroughs(cwd: string): Discovery {
  const root = gitToplevel(cwd);
  if (root === null) return { repoRoot: null, paths: [] };

  const listed = (gitOut(["ls-files", "-z"], root) ?? "").split("\0").filter((path) => path !== "");
  const paths = listed
    .filter((path) => WALKTHROUGH_PATH.test(path))
    .filter((path) => hasWalkthroughKey(join(root, path)))
    .sort();
  return { repoRoot: root, paths };
}

/**
 * The walkthroughs a commit holds: the same convention, read from the object
 * store — served ref mode looks here when the branch is not checked out.
 */
export function discoverWalkthroughsAt(root: string, commit: string): string[] {
  const listed = (gitOut(["ls-tree", "-r", "--name-only", "-z", commit], root) ?? "")
    .split("\0")
    .filter((path) => path !== "");
  return listed
    .filter((path) => WALKTHROUGH_PATH.test(path))
    .filter((path) => {
      const source = gitOut(["show", `${commit}:${path}`], root);
      return source !== null && carriesWalkthroughKey(source);
    })
    .sort();
}

/**
 * The PR number a walkthrough source names, or `null` when the envelope does
 * not say. A scalar read, not a parse: a file whose other keys are broken still
 * names its PR here, and compilation reports what is actually wrong.
 */
export function walkthroughPr(source: string): number | null {
  const block = frontmatterBlock(source.slice(0, 4096));
  if (block === null) return null;
  const match = /^pr\s*:\s*(\d+)\s*$/m.exec(block);
  return match?.[1] === undefined ? null : Number(match[1]);
}

function hasWalkthroughKey(absolute: string): boolean {
  let source: string;
  try {
    source = readFileSync(absolute, "utf8");
  } catch {
    return false;
  }
  return carriesWalkthroughKey(source);
}

/** Looks only at the first 4096 bytes — enough for any frontmatter block. */
const carriesWalkthroughKey = (source: string): boolean => {
  const block = frontmatterBlock(source.slice(0, 4096));
  return block !== null && /^walkthrough\s*:/m.test(block);
};
