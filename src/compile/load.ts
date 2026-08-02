/**
 * One walkthrough file to one payload: read, parse, resolve, compile. The
 * served mode calls this per request; `check` calls it per discovered file.
 */

import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve as resolvePath } from "node:path";
import type { CheckDiagnostic, Payload, RangeEcho } from "../payload/types.js";
import { resolveContext } from "../resolve/git.js";
import { compileDocument } from "./compile.js";
import { parseDocument, type ValidDocument } from "./document.js";

export interface LoadOptions {
  cwd: string;
  /** Path of the walkthrough file, absolute or relative to `cwd`. */
  path: string;
  /** Chrome language override (`--lang`). */
  lang?: "en" | "fr";
  /** `false` skips gh entirely. */
  useGh?: boolean;
}

export interface LoadResult {
  /** Repo-relative path when the repository resolves, else the given path. */
  sourcePath: string;
  payload: Payload | null;
  diagnostics: CheckDiagnostic[];
  ranges: RangeEcho[];
}

export function loadWalkthrough(options: LoadOptions): LoadResult {
  const absolute = isAbsolute(options.path) ? options.path : resolvePath(options.cwd, options.path);
  const repoRelative = toRepoRelative(absolute, options.cwd);

  let source: string;
  try {
    source = readFileSync(absolute, "utf8");
  } catch {
    return {
      sourcePath: repoRelative,
      payload: null,
      ranges: [],
      diagnostics: [
        {
          code: "file-unresolvable",
          level: "error",
          file: repoRelative,
          message: "The walkthrough file does not exist.",
          hint: "Check the path, or run `balade check` with no argument to validate every discovered walkthrough.",
        },
      ],
    };
  }

  const doc = parseDocument(source, repoRelative);
  const { frontmatter } = doc;
  if (frontmatter === null) {
    return { sourcePath: repoRelative, payload: null, diagnostics: doc.diagnostics, ranges: [] };
  }
  const valid: ValidDocument = {
    ast: doc.ast,
    source: doc.source,
    raw: doc.raw,
    frontmatter,
    preset: doc.preset,
  };

  const resolved = resolveContext({
    cwd: dirname(absolute),
    pr: frontmatter.pr,
    commit: frontmatter.commit,
    file: repoRelative,
    ...(options.useGh !== undefined ? { useGh: options.useGh } : {}),
  });
  const diagnostics = [...doc.diagnostics, ...resolved.diagnostics];
  if (resolved.ctx === null) {
    return { sourcePath: repoRelative, payload: null, diagnostics, ranges: [] };
  }

  /* `git rev-parse` returns the real path; a symlinked temp dir would break the relative path. */
  const sourcePath = relative(real(resolved.ctx.repoRoot), real(absolute)) || repoRelative;
  const compiled = compileDocument({
    doc: valid,
    ctx: resolved.ctx,
    sourcePath,
    ...(options.lang !== undefined ? { lang: options.lang } : {}),
  });

  return {
    sourcePath,
    payload: compiled.payload,
    diagnostics: [...diagnostics, ...compiled.diagnostics].map((diagnostic) => ({
      ...diagnostic,
      file: sourcePath,
    })),
    ranges: compiled.ranges,
  };
}

function toRepoRelative(absolute: string, cwd: string): string {
  const rel = relative(cwd, absolute);
  return rel === "" || rel.startsWith("..") ? absolute : rel;
}

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
