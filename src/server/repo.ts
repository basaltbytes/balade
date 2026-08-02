/**
 * The git and file reads served mode makes. Every endpoint reaches disk
 * through this adapter, so the API above it is a function of the values it
 * answers and a test supplies its own.
 *
 * Two costs live here and are kept apart on purpose: `load` shells out to git
 * some twenty-five times and is what the payload cache exists to avoid; `pin`,
 * `row`, `head` and `distance` are one file read or one git call each and run
 * per request.
 */

import Markdoc from "@markdoc/markdoc";
import type { Node } from "@markdoc/markdoc";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadWalkthrough, type LoadResult } from "../compile/load.js";
import { gitOut } from "../resolve/exec.js";
import { repoSlug } from "../resolve/git.js";
import { frontmatterBlock, parseFrontmatter, type Frontmatter } from "../schema/frontmatter.js";

/** What one index row needs, read straight from the file and from git. */
export interface IndexRow {
  title: string;
  pr: number;
  meta: Record<string, string>;
  /** ISO date of the last commit that touched the file. */
  updatedAt: string;
  /** `section` tags the file declares — the progress denominator of the row. */
  sections: number;
}

export interface ServerRepo {
  readonly root: string;
  /** `owner/name` when the remote is known, else the repository directory name. */
  readonly slug: string;
  /** Current HEAD; one third of a payload cache key. */
  head(): string;
  /** The stamp the file carries now, or `null` when its frontmatter is unreadable. */
  pin(sourcePath: string): string | null;
  /** Commits between a stamp and HEAD, or `null` when the stamp is not in this clone. */
  distance(pin: string): number | null;
  /** Index-row facts, or `null` when the file no longer carries a valid envelope. */
  row(sourcePath: string): IndexRow | null;
  /** Compiles one walkthrough. Slow: the payload cache calls it once per key. */
  load(sourcePath: string): LoadResult;
}

export interface RepoOptions {
  /** Absolute repository root; every `sourcePath` is relative to it. */
  root: string;
  /** Chrome language override (`--lang`). */
  lang?: "en" | "fr";
  /** `false` skips gh entirely. */
  useGh?: boolean;
}

export function serverRepo(options: RepoOptions): ServerRepo {
  const { root } = options;
  const absolute = (sourcePath: string): string => join(root, sourcePath);

  /** The file as it is on disk now, with its envelope proven. */
  const envelope = (sourcePath: string): { source: string; frontmatter: Frontmatter } | null => {
    const source = read(absolute(sourcePath));
    if (source === null) return null;
    const block = frontmatterBlock(source);
    if (block === null) return null;
    const frontmatter = parseFrontmatter(block, sourcePath).frontmatter;
    return frontmatter === null ? null : { source, frontmatter };
  };

  return {
    root,
    slug: repoSlug(root),

    head: () => gitOut(["rev-parse", "HEAD"], root)?.trim() ?? "",

    pin: (sourcePath) => envelope(sourcePath)?.frontmatter.commit ?? null,

    distance: (pin) => {
      const out = gitOut(["rev-list", "--count", `${pin}..HEAD`], root)?.trim();
      if (out === undefined) return null;
      const count = Number(out);
      return Number.isFinite(count) ? count : null;
    },

    row: (sourcePath) => {
      const found = envelope(sourcePath);
      if (found === null) return null;
      return {
        title: found.frontmatter.title,
        pr: found.frontmatter.pr,
        meta: found.frontmatter.meta,
        updatedAt: gitOut(["log", "-1", "--format=%cI", "--", sourcePath], root)?.trim() ?? "",
        sections: countSections(found.source),
      };
    },

    load: (sourcePath) =>
      loadWalkthrough({
        cwd: root,
        path: absolute(sourcePath),
        ...(options.lang !== undefined ? { lang: options.lang } : {}),
        ...(options.useGh !== undefined ? { useGh: options.useGh } : {}),
      }),
  };
}

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** The index counts sections without resolving anything: a parse, no git. */
function countSections(source: string): number {
  let count = 0;
  const walk = (nodes: readonly Node[]): void => {
    for (const node of nodes) {
      if (node.type === "tag" && node.tag === "section") count += 1;
      walk(node.children);
    }
  };
  walk(Markdoc.parse(source).children);
  return count;
}
