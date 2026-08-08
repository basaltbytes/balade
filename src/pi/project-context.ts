/** Repository instructions selected from the pinned pull-request snapshot. */

import { Effect } from "effect";
import type { AuthorNotice, HeadInstructionPolicy } from "./author.js";
import type {
  PinnedRepositorySnapshot,
  SnapshotPathRejected,
  SnapshotReadFailed,
} from "./snapshot.js";

const PROJECT_CONTEXT_FILE_NAMES = ["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];
const PROJECT_CONTEXT_CLOSING_TAG = /<\/project_(?:instructions|context)\s*>/iu;

export interface ProjectContextFile {
  readonly path: string;
  readonly content: string;
}

export interface PinnedProjectContext {
  readonly files: readonly ProjectContextFile[];
  readonly notices: readonly AuthorNotice[];
}

export interface LoadPinnedProjectContextOptions {
  readonly pin: string;
  readonly changedPaths: ReadonlySet<string>;
  readonly headInstructionPolicy: HeadInstructionPolicy;
}

export const loadPinnedProjectContext = Effect.fn("loadPinnedProjectContext")(function* (
  options: LoadPinnedProjectContextOptions,
  snapshot: PinnedRepositorySnapshot,
): Effect.fn.Return<PinnedProjectContext, SnapshotPathRejected | SnapshotReadFailed> {
  const available = new Set(yield* snapshot.listFiles);
  const directories = new Set([""]);
  for (const changedPath of options.changedPaths) {
    const parts = changedPath.split("/");
    parts.pop();
    let directory = "";
    for (const part of parts) {
      directory = directory === "" ? part : `${directory}/${part}`;
      directories.add(directory);
    }
  }
  const orderedDirectories = [...directories].sort((left, right) => {
    const depth = pathDepth(left) - pathDepth(right);
    return depth === 0 ? left.localeCompare(right) : depth;
  });
  const paths = orderedDirectories.flatMap((directory) => {
    const prefix = directory === "" ? "" : `${directory}/`;
    const selected = PROJECT_CONTEXT_FILE_NAMES.find((name) => available.has(`${prefix}${name}`));
    return selected === undefined ? [] : [`${prefix}${selected}`];
  });
  const candidates = yield* Effect.all(
    paths.map((path) => snapshot.readFile(path).pipe(Effect.map((content) => ({ path, content })))),
    { concurrency: "unbounded" },
  );
  const files: ProjectContextFile[] = [];
  const notices: AuthorNotice[] = [];
  for (const candidate of candidates) {
    const namedPath = JSON.stringify(candidate.path);
    if (PROJECT_CONTEXT_CLOSING_TAG.test(candidate.content)) {
      notices.push({
        _tag: "AuthorNotice",
        code: "project-instructions-rejected",
        message: `Skipped ${namedPath}: it contains a project-context closing tag that could escape the system-prompt boundary.`,
        hint: `Remove the closing tag from ${namedPath}; balade never loads instruction files that can break the project-context boundary.`,
      });
      continue;
    }

    const changedAtHead = options.changedPaths.has(candidate.path);
    if (changedAtHead && options.headInstructionPolicy === "omit-changed") {
      notices.push({
        _tag: "AuthorNotice",
        code: "head-instructions-skipped",
        message: `Skipped ${namedPath} because this pull request changes it.`,
        hint: `Review ${namedPath}, then pass --trust-head-instructions to apply it during generation.`,
      });
      continue;
    }
    if (changedAtHead) {
      notices.push({
        _tag: "AuthorNotice",
        code: "head-instructions-trusted",
        message: `Loaded ${namedPath} because --trust-head-instructions explicitly trusts instruction files changed by this pull request.`,
        hint: "Remove --trust-head-instructions to keep changed instruction files out of authoring.",
      });
    }
    files.push({
      path: `${options.pin}:${escapeProjectContextPath(candidate.path)}`,
      content: candidate.content,
    });
  }
  return { files, notices };
});

function escapeProjectContextPath(path: string): string {
  return path
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function pathDepth(path: string): number {
  return path === "" ? 0 : path.split("/").length;
}
