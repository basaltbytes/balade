/** Pi's per-generation session, restricted to balade-owned read-only tools. */

import type {
  AgentSession,
  GrepToolDetails,
  ModelRuntime,
  ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import Markdoc from "@markdoc/markdoc";
import type { Node } from "@markdoc/markdoc";
import { Effect, FileSystem, Option, Path, Result } from "effect";
import { CommandExecutor, gitOut } from "../shell.js";
import type { AuthoringRequest } from "./author.js";
import { AUTHORING_LIMITS } from "../authoring/package.js";
import { authoringSystemPrompt } from "./authoring.js";
import { loadPinnedProjectContext, type ProjectContextFile } from "./project-context.js";
import { openPinnedRepositorySnapshot, type ResolvedSnapshotPath } from "./snapshot.js";

export type CodingAgentSdk = typeof import("@earendil-works/pi-coding-agent");
export type AiSdk = typeof import("@earendil-works/pi-ai");

export interface PiSessionDependencies {
  readonly coding: CodingAgentSdk;
  readonly ai: AiSdk;
  readonly modelRuntime: ModelRuntime;
}

type SessionDependencies = CommandExecutor | FileSystem.FileSystem | Path.Path;
type RunSessionEffect = <A, E>(effect: Effect.Effect<A, E, SessionDependencies>) => Promise<A>;

const MAX_TREE_FILES = 2_000;
const MAX_SOURCE_LINES = 400;
const MAX_DIFF_LINES = 800;
const MAX_SEARCH_MATCHES = 200;
const MAX_TOOL_CHARACTERS = 80_000;
const SESSION_ABORT_TIMEOUT = "1 second";
export async function createPiSession(
  pi: PiSessionDependencies,
  model: Model<string>,
  request: AuthoringRequest,
  runSessionEffect: RunSessionEffect,
  snapshotCacheRoot: string,
) {
  let draft: unknown;
  let diffReads = 0;
  let searches = 0;
  let sourceReads = 0;
  const snapshot = await runSessionEffect(
    openPinnedRepositorySnapshot({
      cacheRoot: snapshotCacheRoot,
      repositoryRoot: request.root,
      pin: request.pin,
    }),
  );
  let sourcePathLoad: Promise<readonly string[]> | undefined;
  const sourcePaths = (): Promise<readonly string[]> => {
    if (sourcePathLoad === undefined) {
      sourcePathLoad = runSessionEffect(snapshot.listFiles);
    }
    return sourcePathLoad;
  };
  const changed = new Set(request.files.map((file) => file.path));
  const projectContext = await loadPinnedProjectContext(
    {
      pin: request.pin,
      changedPaths: changed,
      trustHeadInstructions: request.trustHeadInstructions,
    },
    snapshot,
    sourcePaths,
  );
  for (const notice of projectContext.notices) request.progress(notice);

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
      const matching = (await sourcePaths()).filter((path) => path.startsWith(prefix));
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
  const searchConfiguration = await runSessionEffect(writeSearchConfiguration(snapshotCacheRoot));
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
      if (searches >= AUTHORING_LIMITS.searches) {
        return toolText(
          `Source search budget reached after ${AUTHORING_LIMITS.searches} searches. Use the matches already collected to choose exact source ranges, then submit the walkthrough.`,
        );
      }
      const scope = await runSessionEffect(snapshot.resolvePath(params.path ?? "."));
      searches++;
      const result = await withSearchConfiguration(searchConfiguration, () =>
        grep.execute(
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
        ),
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
      if (diffReads >= AUTHORING_LIMITS.diffReads) {
        return toolText(
          `Diff inspection budget reached after ${AUTHORING_LIMITS.diffReads} reads. Use the evidence already collected, confirm only the source needed for selected ranges, then submit the walkthrough.`,
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
      if (!(await sourcePaths()).includes(params.path)) {
        throw new Error(`${params.path} does not exist at ${request.pin}.`);
      }
      if (sourceReads >= AUTHORING_LIMITS.sourceReads) {
        return toolText(
          `Source inspection budget reached after ${AUTHORING_LIMITS.sourceReads} reads. Submit using the verified ranges already collected; do not invent more.`,
        );
      }
      sourceReads++;
      const content = await runSessionEffect(snapshot.readFile(params.path));
      return toolText(numberedLines(params.path, content, params.from, params.to));
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
      const sourcePath = repositoryPath(params.path);
      if (sourceReads >= AUTHORING_LIMITS.sourceReads) {
        return toolText(
          `Source inspection budget reached after ${AUTHORING_LIMITS.sourceReads} reads. Submit using the verified ranges already collected; do not invent more.`,
        );
      }
      sourceReads++;
      const content = await runSessionEffect(
        gitOut(["show", `${request.base}:${sourcePath}`], request.root),
      );
      return toolText(numberedLines(sourcePath, content, params.from, params.to));
    },
  });

  const submit = pi.coding.defineTool({
    name: "submit_walkthrough",
    label: "Submit walkthrough",
    description: "Submit the complete walkthrough draft and finish this authoring turn.",
    executionMode: "sequential" as const,
    parameters: pi.ai.Type.Object({
      title: pi.ai.Type.String({ minLength: 1 }),
      meta: pi.ai.Type.Record(pi.ai.Type.String(), pi.ai.Type.String()),
      preset: pi.ai.Type.Optional(pi.ai.Type.String({ minLength: 1 })),
      body: pi.ai.Type.String({ minLength: 1 }),
    }),
    execute: async (_id, params) => {
      const rangeCount = codeRangeCount(params.body);
      if (rangeCount > AUTHORING_LIMITS.codeRanges) {
        return toolText(
          `The draft has ${rangeCount} code ranges; the hard maximum is ${AUTHORING_LIMITS.codeRanges}. Keep only the ranges needed for the review story, then submit the complete draft again.`,
        );
      }
      draft = {
        title: params.title,
        meta: params.meta,
        body: params.body,
        ...(params.preset === undefined ? {} : { preset: params.preset }),
      };
      return {
        ...toolText("Walkthrough draft received."),
        terminate: true,
      };
    },
  });

  const { session } = await pi.coding.createAgentSession({
    cwd: snapshot.root,
    model,
    modelRuntime: pi.modelRuntime,
    resourceLoader: minimalResourceLoader(
      pi.coding,
      authoringSystemPrompt(request.preset),
      projectContext.files,
    ),
    tools: [
      "list_pr_changes",
      "list_source_files",
      "search_source",
      "read_pr_diff",
      "read_source",
      "read_base_source",
      "submit_walkthrough",
    ],
    customTools: [
      listChanges,
      listSources,
      searchSource,
      readDiff,
      readSource,
      readBaseSource,
      submit,
    ],
    sessionManager: pi.coding.SessionManager.inMemory(snapshot.root),
    settingsManager: pi.coding.SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false },
    }),
  });
  const unsubscribe = session.subscribe((event) => {
    if (
      request.progressMode === "verbose" &&
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_end" &&
      event.assistantMessageEvent.content !== ""
    ) {
      request.progress({
        _tag: "AuthorAssistantText",
        text: event.assistantMessageEvent.content,
      });
    } else if (event.type === "tool_execution_start") {
      request.progress({
        _tag: "AuthorToolStarted",
        name: event.toolName,
        input: request.progressMode === "verbose" ? verboseValue(event.args) : "",
      });
    } else if (request.progressMode === "verbose" && event.type === "tool_execution_end") {
      request.progress({
        _tag: "AuthorToolFinished",
        name: event.toolName,
        output: verboseToolOutput(event.result),
        failed: event.isError,
      });
    }
  });

  return {
    session,
    unsubscribe,
    clearDraft: () => {
      draft = undefined;
    },
    resetInspectionBudget: () => {
      diffReads = 0;
      searches = 0;
      sourceReads = 0;
    },
    getDraft: () => draft,
  };
}

export function releasePiSession(session: AgentSession): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (!session.isIdle) {
      const aborted = yield* Effect.tryPromise(() => session.abort()).pipe(
        Effect.result,
        Effect.timeoutOption(SESSION_ABORT_TIMEOUT),
      );
      if (Option.isNone(aborted)) {
        yield* Effect.logWarning("Pi session abort timed out during cleanup");
      } else if (Result.isFailure(aborted.value)) {
        yield* Effect.logWarning("Pi session abort failed during cleanup");
      }
    }
    yield* Effect.try(() => session.dispose()).pipe(
      Effect.catch(() => Effect.logWarning("Pi session disposal failed during cleanup")),
    );
  });
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

function verboseValue(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function verboseToolOutput(result: unknown): string {
  if (typeof result !== "object" || result === null || !("content" in result)) {
    return verboseValue(result);
  }
  const content = result.content;
  if (!Array.isArray(content)) return verboseValue(result);
  return content
    .map((block) =>
      typeof block === "object" &&
      block !== null &&
      "type" in block &&
      block.type === "text" &&
      "text" in block &&
      typeof block.text === "string"
        ? block.text
        : verboseValue(block),
    )
    .join("\n");
}

function codeRangeCount(body: string): number {
  let count = 0;
  const visit = (nodes: readonly Node[]): void => {
    for (const node of nodes) {
      if (node.type === "tag" && node.tag === "code") count++;
      visit(node.children);
    }
  };
  visit(Markdoc.parse(body).children);
  return count;
}

function toolText(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: {},
  };
}

function minimalResourceLoader(
  coding: CodingAgentSdk,
  systemPrompt: string,
  projectContextFiles: readonly ProjectContextFile[],
): ResourceLoader {
  return {
    getExtensions: () => ({
      extensions: [],
      errors: [],
      runtime: coding.createExtensionRuntime(),
    }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [...projectContextFiles] }),
    getSystemPrompt: () => systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

function limitCharacters(value: string): string {
  return value.length <= MAX_TOOL_CHARACTERS
    ? value
    : `${value.slice(0, MAX_TOOL_CHARACTERS)}\n… output capped at ${MAX_TOOL_CHARACTERS} characters.`;
}

function repositoryPath(sourcePath: string): string {
  const normalized = sourcePath.replace(/^\.\//u, "");
  const segments = normalized.split("/");
  if (
    normalized === "" ||
    normalized.startsWith("/") ||
    normalized.includes("\\") ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`${sourcePath} is not a contained repo-relative path.`);
  }
  return normalized;
}

/**
 * Search must not depend on the user's environment: `--no-ignore` keeps the
 * snapshot's committed ignore files inert even when the cache sits inside a
 * git repository, and `--no-follow` keeps ripgrep from reading through a
 * symlink that points outside the snapshot.
 */
const writeSearchConfiguration = Effect.fn("writeSearchConfiguration")(function* (
  cacheRoot: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(cacheRoot, "ripgrep.conf");
  yield* fs.writeFileString(file, "--no-ignore\n--no-follow\n");
  return file;
});

/**
 * Pi spawns ripgrep with the inherited environment, so a user-level
 * RIPGREP_CONFIG_PATH could follow symlinks out of the snapshot or filter
 * matches. Every search runs under the balade-owned configuration instead.
 */
async function withSearchConfiguration<A>(
  configuration: string,
  search: () => Promise<A>,
): Promise<A> {
  const previous = process.env.RIPGREP_CONFIG_PATH;
  process.env.RIPGREP_CONFIG_PATH = configuration;
  try {
    return await search();
  } finally {
    if (previous === undefined) delete process.env.RIPGREP_CONFIG_PATH;
    else process.env.RIPGREP_CONFIG_PATH = previous;
  }
}

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
  /* Lazy up to the first ":<line>: " so colons in the match text stay out of the key. */
  const leftMatch = /^(.*?):(\d+): /u.exec(left);
  const rightMatch = /^(.*?):(\d+): /u.exec(right);
  if (leftMatch === null || rightMatch === null) return compareText(left, right);
  const leftPath = leftMatch[1] ?? "";
  const rightPath = rightMatch[1] ?? "";
  const paths = compareText(leftPath, rightPath);
  return paths === 0 ? Number(leftMatch[2] ?? "0") - Number(rightMatch[2] ?? "0") : paths;
}
