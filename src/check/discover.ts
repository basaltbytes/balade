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

/** Reads only the first 4096 bytes — enough for any frontmatter block. */
function hasWalkthroughKey(absolute: string): boolean {
  let head: string;
  try {
    head = readFileSync(absolute, "utf8").slice(0, 4096);
  } catch {
    return false;
  }
  const block = frontmatterBlock(head);
  return block !== null && /^walkthrough\s*:/m.test(block);
}
