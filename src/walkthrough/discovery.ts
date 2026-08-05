/**
 * Discovery: git-tracked files matching `**‍/walkthroughs/*.md` whose
 * frontmatter carries the `walkthrough` key. Tracked-only keeps the scan
 * bounded and works the same at the repo root and per package in a monorepo.
 */

import { Effect, FileSystem, Option, Path, Schema } from "effect";
import type { CommandFailed, NotARepository } from "../contract/context.js";
import { gitOut, gitToplevel } from "../shell.js";
import { frontmatterBlock } from "./frontmatter.js";

const WALKTHROUGH_PATH = /(?:^|\/)walkthroughs\/[^/]+\.md$/;

/** What every command says when discovery comes back empty. */
export const NO_WALKTHROUGH =
  "No walkthrough found. A walkthrough is a git-tracked `**/walkthroughs/*.md` file whose frontmatter holds the `walkthrough` key.";

export const NOT_A_REPO =
  "Not inside a git repository — run balade from the repository that holds the walkthrough.";

export interface Discovery {
  repoRoot: string;
  /** Repo-relative paths, sorted. */
  paths: string[];
}

export class WalkthroughReadFailed extends Schema.TaggedErrorClass<WalkthroughReadFailed>()(
  "WalkthroughReadFailed",
  { path: Schema.String, cause: Schema.Defect() },
) {}

export type DiscoveryError = NotARepository | CommandFailed | WalkthroughReadFailed;

export const discoverWalkthroughs = Effect.fn("discoverWalkthroughs")(function* (cwd: string) {
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const root = yield* gitToplevel(cwd);
  const listed = (yield* gitOut(["ls-files", "-z"], root))
    .split("\0")
    .filter((path) => path !== "");
  const paths: string[] = [];
  for (const path of listed.filter((candidate) => WALKTHROUGH_PATH.test(candidate))) {
    if (yield* hasWalkthroughKey(fs, pathService.join(root, path))) paths.push(path);
  }
  return { repoRoot: root, paths: paths.sort() } satisfies Discovery;
});

/**
 * The walkthroughs a commit holds: the same convention, read from the object
 * store — served ref mode looks here when the branch is not checked out.
 */
export const discoverWalkthroughsAt = Effect.fn("discoverWalkthroughsAt")(function* (
  root: string,
  commit: string,
) {
  const listed = (yield* gitOut(["ls-tree", "-r", "--name-only", "-z", commit], root))
    .split("\0")
    .filter((path) => path !== "");
  const paths: string[] = [];
  for (const path of listed.filter((candidate) => WALKTHROUGH_PATH.test(candidate))) {
    const source = yield* gitOut(["show", `${commit}:${path}`], root);
    if (carriesWalkthroughKey(source)) paths.push(path);
  }
  return paths.sort();
});

/**
 * The PR number a walkthrough source names, or `None` when the envelope does
 * not say. A scalar read, not a parse: a file whose other keys are broken still
 * names its PR here, and compilation reports what is actually wrong.
 */
export function walkthroughPr(source: string): Option.Option<number> {
  const block = frontmatterBlock(source.slice(0, 4096));
  if (block === null) return Option.none();
  const match = /^pr\s*:\s*(\d+)\s*$/m.exec(block);
  return match?.[1] === undefined ? Option.none() : Option.some(Number(match[1]));
}

export function discoveryErrorMessage(error: DiscoveryError): string {
  switch (error._tag) {
    case "NotARepository":
      return error.note;
    case "CommandFailed":
      return `${error.file} ${error.args.join(" ")} failed (exit ${error.code}).`;
    case "WalkthroughReadFailed":
      return `Could not read walkthrough source at ${error.path}.`;
  }
}

const hasWalkthroughKey = (fs: FileSystem.FileSystem, absolute: string) =>
  fs.readFileString(absolute).pipe(
    Effect.mapError((cause) => new WalkthroughReadFailed({ path: absolute, cause })),
    Effect.map(carriesWalkthroughKey),
  );

/** Looks only at the first 4096 bytes — enough for any frontmatter block. */
const carriesWalkthroughKey = (source: string): boolean => {
  const block = frontmatterBlock(source.slice(0, 4096));
  return block !== null && /^walkthrough\s*:/m.test(block);
};
