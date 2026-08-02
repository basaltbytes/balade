/**
 * One walkthrough file to one payload: read, parse, resolve, compile. The
 * served mode calls this per request; `check` calls it per discovered file.
 */

import { Effect, FileSystem, Path, Schema } from "effect";
import type { CheckDiagnostic, Payload, RangeEcho } from "../payload/types.js";
import type { CommandFailed } from "../resolve/exec.js";
import { resolveContext, type ResolveError } from "../resolve/git.js";
import { repoRelative, type PathResolutionFailed } from "../resolve/paths.js";
import { compileDocument, referencedFiles } from "./compile.js";
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

export class WalkthroughFileReadFailed extends Schema.TaggedErrorClass<WalkthroughFileReadFailed>()(
  "WalkthroughFileReadFailed",
  { path: Schema.String, cause: Schema.Defect() },
) {}

export type LoadError = ResolveError | PathResolutionFailed | WalkthroughFileReadFailed;

export const loadWalkthrough = Effect.fn("loadWalkthrough")(function* (options: LoadOptions) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolute = path.isAbsolute(options.path)
    ? options.path
    : path.resolve(options.cwd, options.path);
  const givenPath = toGivenPath(path, absolute, options.cwd);

  const source =
    options.source ??
    (yield* fs
      .readFileString(absolute)
      .pipe(Effect.mapError((cause) => new WalkthroughFileReadFailed({ path: givenPath, cause }))));

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
  const resolved = yield* resolveContext({
    cwd: options.source === undefined ? path.dirname(absolute) : options.cwd,
    pr: frontmatter.pr,
    commit: frontmatter.commit,
    file: givenPath,
    references: referencedFiles(valid),
    ...(options.at !== undefined ? { at: options.at } : {}),
    ...(options.useGh !== undefined ? { useGh: options.useGh } : {}),
  });
  const diagnostics = [...doc.diagnostics, ...resolved.diagnostics];
  const sourcePath =
    options.source === undefined
      ? (yield* repoRelative(resolved.ctx.repoRoot, absolute)) || givenPath
      : givenPath;
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
});

/** Translates a real load failure into `check`'s product vocabulary at its boundary. */
export function loadErrorDiagnostic(error: LoadError): CheckDiagnostic {
  switch (error._tag) {
    case "WalkthroughFileReadFailed":
      return {
        code: "file-unresolvable",
        level: "error",
        file: error.path,
        message: "The walkthrough file does not exist or cannot be read.",
        hint: "Check the path, or run `balade check` with no argument to validate every discovered walkthrough.",
      };
    case "NotARepository":
      return {
        code: "repo-unresolvable",
        level: "error",
        file: error.cwd,
        message: "This directory is not inside a git repository.",
        hint: "Run balade from the repository that holds the walkthrough.",
      };
    case "CommitUnresolvable":
      return {
        code: "commit-unresolvable",
        level: "error",
        file: error.file,
        message: `The stamped commit \`${error.commit}\` is not in this clone.`,
        hint: "Fetch the branch (CI needs `fetch-depth: 0`), or re-stamp the walkthrough against a commit you have.",
      };
    case "PathResolutionFailed":
      return {
        code: "file-unresolvable",
        level: "error",
        file: error.path,
        message: "The walkthrough path could not be resolved.",
        hint: "Check that the repository and walkthrough path are readable.",
      };
    case "CommandFailed":
      return commandDiagnostic(error);
  }
}

const commandDiagnostic = (error: CommandFailed): CheckDiagnostic => ({
  code: "git-unresolvable",
  level: "error",
  file: error.cwd,
  message: `\`${error.file} ${error.args.join(" ")}\` failed (exit ${error.code}).`,
  hint: "Run the command directly to inspect the repository failure.",
});

/** The given path spelled relative to `cwd` where it fits beneath it, with forward slashes. */
function toGivenPath(path: Path.Path, absolute: string, cwd: string): string {
  const rel = path.relative(cwd, absolute);
  return rel === "" || rel.startsWith("..") ? absolute : rel.replaceAll(path.sep, "/");
}
