/**
 * One walkthrough file to one payload: read, parse, resolve, compile. The
 * served mode calls this per request; `check` calls it per discovered file.
 */

import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve as resolvePath, sep } from "node:path";
import type { CheckDiagnostic, Payload, RangeEcho } from "../payload/types.js";
import { resolveContext } from "../resolve/git.js";
import { repoRelative } from "../resolve/paths.js";
import { compileDocument } from "./compile.js";
import { parseDocument, type ValidDocument } from "./document.js";

export interface LoadOptions {
  cwd: string;
  /** Path of the walkthrough file, absolute or relative to `cwd`. */
  path: string;
  /** Walkthrough text already read — ref mode, where the file may not be in the working tree. */
  source?: string;
  /** Fetched commit the walkthrough is served at (ref mode); threads to resolution. */
  at?: string;
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
  const givenPath = toGivenPath(absolute, options.cwd);

  let source: string;
  try {
    source = options.source ?? readFileSync(absolute, "utf8");
  } catch {
    return {
      sourcePath: givenPath,
      payload: null,
      ranges: [],
      diagnostics: [
        {
          code: "file-unresolvable",
          level: "error",
          file: givenPath,
          message: "The walkthrough file does not exist.",
          hint: "Check the path, or run `balade check` with no argument to validate every discovered walkthrough.",
        },
      ],
    };
  }

  const doc = parseDocument(source, givenPath);
  const { frontmatter } = doc;
  if (frontmatter === null) {
    return { sourcePath: givenPath, payload: null, diagnostics: doc.diagnostics, ranges: [] };
  }
  const valid: ValidDocument = {
    ast: doc.ast,
    source: doc.source,
    raw: doc.raw,
    frontmatter,
    preset: doc.preset,
  };

  /* Ref mode: the walkthrough's directory may not exist on disk, so git runs
     from `cwd` — the repository root the server resolved. */
  const resolved = resolveContext({
    cwd: options.source === undefined ? dirname(absolute) : options.cwd,
    pr: frontmatter.pr,
    commit: frontmatter.commit,
    file: givenPath,
    ...(options.at !== undefined ? { at: options.at } : {}),
    ...(options.useGh !== undefined ? { useGh: options.useGh } : {}),
  });
  const diagnostics = [...doc.diagnostics, ...resolved.diagnostics];
  if (resolved.ctx === null) {
    return { sourcePath: givenPath, payload: null, diagnostics, ranges: [] };
  }

  const sourcePath = repoRelative(resolved.ctx.repoRoot, absolute) || givenPath;
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

/** The given path spelled relative to `cwd` where it fits beneath it, with forward slashes. */
function toGivenPath(absolute: string, cwd: string): string {
  const rel = relative(cwd, absolute);
  return rel === "" || rel.startsWith("..") ? absolute : rel.replaceAll(sep, "/");
}
