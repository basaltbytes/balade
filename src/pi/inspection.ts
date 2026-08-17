/** Shared, pinned, read-only repository tools for every Pi review run. */

import type { GrepToolDetails } from "@earendil-works/pi-coding-agent";
import { Effect, FileSystem, Path } from "effect";
import type { InspectionTier } from "../authoring/package.js";
import { inspectionBudget } from "../authoring/package.js";
import { CommandExecutor, gitOut } from "../shell.js";
import type { AuthorChangedFile } from "./author.js";
import { AuthorSearchConfigurationFailed } from "./author.js";
import type { PinnedRepositorySnapshot, ResolvedSnapshotPath } from "./snapshot.js";
import { AuthorSourceUnavailable, parseAuthorSourcePath } from "./source-path.js";

type SessionDependencies = CommandExecutor | FileSystem.FileSystem | Path.Path;
export type RunSessionEffect = <A, E>(
  effect: Effect.Effect<A, E, SessionDependencies>,
) => Promise<A>;

export interface PiInspectionRequest {
  readonly root: string;
  readonly pin: string;
  readonly base: string;
  readonly files: readonly AuthorChangedFile[];
  readonly budget?: InspectionTier;
}

interface PiInspectionDependencies {
  readonly coding: typeof import("@earendil-works/pi-coding-agent");
  readonly ai: typeof import("@earendil-works/pi-ai");
}

const MAX_TREE_FILES = 2_000;
const MAX_SOURCE_LINES = 400;
const MAX_DIFF_LINES = 800;
const MAX_SEARCH_MATCHES = 200;
const MAX_TOOL_CHARACTERS = 80_000;

export async function createInspectionTools(
  pi: PiInspectionDependencies,
  request: PiInspectionRequest,
  runSessionEffect: RunSessionEffect,
  snapshot: PinnedRepositorySnapshot,
) {
  let diffReads = 0;
  let searches = 0;
  let sourceReads = 0;
  const changed = new Set(request.files.map((file) => file.path));
  const budget = inspectionBudget(changed.size, request.budget ?? "medium");

  const listChanges = pi.coding.defineTool({
    name: "list_pr_changes",
    label: "List PR changes",
    description: "List every changed file and its status at the pinned pull-request commit.",
    parameters: pi.ai.Type.Object({}),
    execute: async () =>
      toolText(
        limitCharacters(
          request.files
            .map(
              (file) =>
                `${file.status}\t+${file.additions}\t-${file.deletions}\t${file.path}${
                  file.oldPath === undefined ? "" : `\tfrom ${file.oldPath}`
                }`,
            )
            .join("\n") || "No changed files.",
        ),
      ),
  });

  const listSources = pi.coding.defineTool({
    name: "list_source_files",
    label: "List pinned source files",
    description:
      "List repository paths at the pinned PR commit. Narrow with a literal path prefix in large repositories.",
    parameters: pi.ai.Type.Object({
      prefix: pi.ai.Type.Optional(
        pi.ai.Type.String({ description: "Literal repo-relative prefix" }),
      ),
      offset: pi.ai.Type.Optional(
        pi.ai.Type.Integer({ minimum: 0, description: "Zero-based result offset" }),
      ),
      limit: pi.ai.Type.Optional(
        pi.ai.Type.Integer({ minimum: 1, maximum: MAX_TREE_FILES, description: "Page size" }),
      ),
    }),
    execute: async (_id, params) => {
      const prefix = params.prefix?.replace(/^\.\//u, "") ?? "";
      const matching = (await runSessionEffect(snapshot.listFiles)).filter((path) =>
        path.startsWith(prefix),
      );
      const offset = params.offset ?? 0;
      const limit = params.limit ?? MAX_TREE_FILES;
      const visible = matching.slice(offset, offset + limit);
      const suffix =
        matching.length > offset + visible.length
          ? `\n… ${matching.length - offset - visible.length} more; continue at offset ${offset + visible.length} or use a narrower prefix.`
          : "";
      return toolText(limitCharacters(`${visible.join("\n")}${suffix}`));
    },
  });

  const grep = pi.coding.createGrepToolDefinition(snapshot.root);
  const searchSource = pi.coding.defineTool({
    name: "search_source",
    label: "Search pinned source",
    description: `Search the pinned repository snapshot with ripgrep. Results are repo-relative, sorted, and capped at ${MAX_SEARCH_MATCHES} matches.`,
    parameters: pi.ai.Type.Object({
      query: pi.ai.Type.String({ minLength: 1, description: "Fixed text or regular expression" }),
      mode: pi.ai.Type.Optional(
        pi.ai.Type.Union([pi.ai.Type.Literal("fixed"), pi.ai.Type.Literal("regex")], {
          description: "Match mode; defaults to fixed",
        }),
      ),
      path: pi.ai.Type.Optional(
        pi.ai.Type.String({ description: "Repo-relative file or directory scope" }),
      ),
    }),
    execute: async (id, params, signal, onUpdate, context) => {
      if (searches >= budget.searches) {
        return toolText(
          `Source search budget reached after ${budget.searches} searches. Use the evidence already collected to complete the task.`,
        );
      }
      searches++;
      const scope = await runSessionEffect(snapshot.resolvePath(params.path ?? "."));
      const result = await grep.execute(
        id,
        {
          pattern: params.query,
          path: scope.absolute,
          literal: (params.mode ?? "fixed") === "fixed",
          limit: MAX_SEARCH_MATCHES,
        },
        signal,
        onUpdate,
        context,
      );
      return {
        ...result,
        content: result.content.map((block) =>
          block.type === "text"
            ? { ...block, text: normalizeSearchOutput(block.text, scope, result.details) }
            : block,
        ),
      };
    },
  });

  const readDiff = pi.coding.defineTool({
    name: "read_pr_diff",
    label: "Read pinned diff",
    description:
      "Read numbered lines from one changed file's diff from the PR base to the pinned commit.",
    parameters: pi.ai.Type.Object({
      path: pi.ai.Type.String({ description: "Exact changed repo-relative path" }),
      from: pi.ai.Type.Optional(pi.ai.Type.Integer({ minimum: 1, description: "First line" })),
      to: pi.ai.Type.Optional(pi.ai.Type.Integer({ minimum: 1, description: "Last line" })),
    }),
    execute: async (_id, params) => {
      if (!changed.has(params.path)) throw new Error(`${params.path} is not a changed file.`);
      if (diffReads >= budget.diffReads) {
        return toolText(
          `Diff inspection budget reached after ${budget.diffReads} reads. Use the evidence already collected to complete the task.`,
        );
      }
      diffReads++;
      const out = await runSessionEffect(
        gitOut(
          [
            "diff",
            "-M",
            "--unified=40",
            request.base,
            request.pin,
            "--",
            `:(literal)${params.path}`,
          ],
          request.root,
        ),
      );
      return toolText(paginateLines(out, params.from, params.to, MAX_DIFF_LINES));
    },
  });

  const readSource = pi.coding.defineTool({
    name: "read_source",
    label: "Read pinned source",
    description:
      "Read exact, numbered source lines from a repo-relative file at the pinned PR commit.",
    parameters: pi.ai.Type.Object({
      path: pi.ai.Type.String({ description: "Exact repo-relative path" }),
      from: pi.ai.Type.Optional(pi.ai.Type.Integer({ minimum: 1, description: "First line" })),
      to: pi.ai.Type.Optional(pi.ai.Type.Integer({ minimum: 1, description: "Last line" })),
    }),
    execute: async (_id, params) => {
      if (sourceReads >= budget.sourceReads) {
        return toolText(
          `Source inspection budget reached after ${budget.sourceReads} reads. Use the verified ranges already collected to complete the task.`,
        );
      }
      sourceReads++;
      const sourcePath = await runSessionEffect(
        Effect.fromResult(parseAuthorSourcePath(params.path)),
      );
      if (!(await runSessionEffect(snapshot.listFiles)).includes(sourcePath)) {
        await runSessionEffect(
          Effect.fail(
            new AuthorSourceUnavailable({
              path: sourcePath,
              pin: request.pin,
              message: `${sourcePath} does not exist at ${request.pin}.`,
            }),
          ),
        );
      }
      const content = await runSessionEffect(snapshot.readFile(sourcePath));
      return toolText(numberedLines(sourcePath, content, params.from, params.to));
    },
  });

  const readBaseSource = pi.coding.defineTool({
    name: "read_base_source",
    label: "Read base source",
    description:
      "Read exact, numbered source lines from a repo-relative file at the pull request base commit.",
    parameters: pi.ai.Type.Object({
      path: pi.ai.Type.String({ description: "Exact repo-relative path" }),
      from: pi.ai.Type.Optional(pi.ai.Type.Integer({ minimum: 1, description: "First line" })),
      to: pi.ai.Type.Optional(pi.ai.Type.Integer({ minimum: 1, description: "Last line" })),
    }),
    execute: async (_id, params) => {
      if (sourceReads >= budget.sourceReads) {
        return toolText(
          `Source inspection budget reached after ${budget.sourceReads} reads. Use the verified ranges already collected to complete the task.`,
        );
      }
      sourceReads++;
      const sourcePath = await runSessionEffect(
        Effect.fromResult(parseAuthorSourcePath(params.path)),
      );
      const content = await runSessionEffect(
        gitOut(["show", `${request.base}:${sourcePath}`], request.root),
      );
      return toolText(numberedLines(sourcePath, content, params.from, params.to));
    },
  });

  return {
    budget,
    tools: [listChanges, listSources, searchSource, readDiff, readSource, readBaseSource],
    reset: () => {
      diffReads = 0;
      searches = 0;
      sourceReads = 0;
    },
  };
}

function numberedLines(
  path: string,
  content: string,
  requestedFrom: number | undefined,
  requestedTo: number | undefined,
): string {
  const lines = splitLines(content);
  const from = requestedFrom ?? 1;
  const requestedEnd = requestedTo ?? Math.min(lines.length, from + MAX_SOURCE_LINES - 1);
  const to = Math.min(requestedEnd, lines.length, from + MAX_SOURCE_LINES - 1);
  if (from > lines.length || from > to) {
    throw new Error(`${path} has ${lines.length} lines; requested ${from}-${requestedEnd}.`);
  }
  const suffix = requestedEnd > to ? `\n… capped at ${MAX_SOURCE_LINES} lines.` : "";
  return limitCharacters(`${numberLines(lines, from, to)}${suffix}`);
}

function paginateLines(
  value: string,
  requestedFrom: number | undefined,
  requestedTo: number | undefined,
  maximum: number,
): string {
  const lines = splitLines(value);
  const from = requestedFrom ?? 1;
  const requestedEnd = requestedTo ?? Math.min(lines.length, from + maximum - 1);
  const to = Math.min(requestedEnd, lines.length, from + maximum - 1);
  if (from > lines.length || from > to) {
    throw new Error(`Diff has ${lines.length} lines; requested ${from}-${requestedEnd}.`);
  }
  const more = lines.length - to;
  const suffix = more > 0 ? `\n… ${more} more lines; continue at line ${to + 1}.` : "";
  return limitCharacters(`${numberLines(lines, from, to)}${suffix}`);
}

function numberLines(lines: readonly string[], from: number, to: number): string {
  const width = String(to).length;
  return lines
    .slice(from - 1, to)
    .map((line, index) => `${String(from + index).padStart(width)} | ${line}`)
    .join("\n");
}

function splitLines(content: string): string[] {
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

export function toolText(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: {},
  };
}

function limitCharacters(value: string): string {
  return value.length <= MAX_TOOL_CHARACTERS
    ? value
    : `${value.slice(0, MAX_TOOL_CHARACTERS)}\n… output capped at ${MAX_TOOL_CHARACTERS} characters.`;
}

/** Create deterministic ripgrep policy for the pinned snapshot. */
export const writeSearchConfiguration = Effect.fn("writeSearchConfiguration")(function* (
  cacheRoot: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(cacheRoot, "ripgrep.conf");
  yield* fs
    .writeFileString(file, "--no-ignore\n--no-follow\n")
    .pipe(Effect.mapError((cause) => new AuthorSearchConfigurationFailed({ file, cause })));
  return file;
});

/** Pi inherits this process global and exposes no per-ripgrep environment seam. */
export const installSearchConfiguration = Effect.fn("installSearchConfiguration")(
  (configuration: string) =>
    Effect.sync(() => {
      process.env.RIPGREP_CONFIG_PATH = configuration;
    }),
);

function normalizeSearchOutput(
  value: string,
  scope: ResolvedSnapshotPath,
  details: GrepToolDetails | undefined,
): string {
  if (value === "No matches found") return value;
  const [matches = ""] = value.split("\n\n");
  const prefix = searchPathPrefix(scope);
  const sorted = matches
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => `${prefix}${line}`)
    .sort(compareSearchLines)
    .join("\n");
  const notices = [
    details?.matchLimitReached === undefined
      ? undefined
      : `… ${details.matchLimitReached} matches shown; narrow the query or path to continue.`,
    details?.truncation?.truncated === true
      ? "… search output truncated; narrow the query or path to continue."
      : undefined,
    details?.linesTruncated === true
      ? "… some matching lines were shortened; use read_source for their full contents."
      : undefined,
  ].filter((notice): notice is string => notice !== undefined);
  return limitCharacters([sorted, ...notices].join("\n"));
}

function searchPathPrefix(scope: ResolvedSnapshotPath): string {
  if (scope.relative === ".") return "";
  if (scope.type === "Directory") return `${scope.relative}/`;
  const slash = scope.relative.lastIndexOf("/");
  return slash === -1 ? "" : scope.relative.slice(0, slash + 1);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareSearchLines(left: string, right: string): number {
  const leftMatch = /^(.*?):(\d+): /u.exec(left);
  const rightMatch = /^(.*?):(\d+): /u.exec(right);
  if (leftMatch === null || rightMatch === null) return compareText(left, right);
  const leftPath = leftMatch[1] ?? "";
  const rightPath = rightMatch[1] ?? "";
  const paths = compareText(leftPath, rightPath);
  return paths === 0 ? Number(leftMatch[2] ?? "0") - Number(rightMatch[2] ?? "0") : paths;
}
