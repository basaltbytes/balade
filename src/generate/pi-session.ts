/** Pi's per-generation session, restricted to balade-owned read-only tools. */

import type { AgentSession, ModelRuntime, ResourceLoader } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import Markdoc from "@markdoc/markdoc";
import type { Node } from "@markdoc/markdoc";
import { Effect, Option, Result } from "effect";
import { CommandExecutor, gitOut } from "../resolve/exec.js";
import type { AuthoringRequest } from "./author.js";
import { AUTHORING_SYSTEM_PROMPT } from "./prompt.js";

export type CodingAgentSdk = typeof import("@earendil-works/pi-coding-agent");
export type AiSdk = typeof import("@earendil-works/pi-ai");

export interface PiSessionDependencies {
  readonly coding: CodingAgentSdk;
  readonly ai: AiSdk;
  readonly modelRuntime: ModelRuntime;
}

type RunCommand = <A, E>(effect: Effect.Effect<A, E, CommandExecutor>) => Promise<A>;

const MAX_TREE_FILES = 2_000;
const MAX_SOURCE_LINES = 400;
const MAX_DIFF_LINES = 800;
const MAX_TOOL_CHARACTERS = 80_000;
const MAX_DIFF_READS = 8;
const MAX_SOURCE_READS = 12;
const MAX_CODE_RANGES = 10;
const SESSION_ABORT_TIMEOUT = "1 second";

export async function createPiSession(
  pi: PiSessionDependencies,
  model: Model<string>,
  request: AuthoringRequest,
  runCommand: RunCommand,
) {
  let draft: unknown;
  let diffReads = 0;
  let sourceReads = 0;
  let sourcePathLoad: Promise<readonly string[]> | undefined;
  const sourcePaths = (): Promise<readonly string[]> => {
    if (sourcePathLoad === undefined) {
      sourcePathLoad = runCommand(
        gitOut(["ls-tree", "-r", "--name-only", "-z", request.pin], request.root),
      ).then((out) => out.split("\0").filter((path) => path !== ""));
    }
    return sourcePathLoad;
  };
  const changed = new Set(request.files.map((file) => file.path));

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
      if (diffReads >= MAX_DIFF_READS) {
        return toolText(
          `Diff inspection budget reached after ${MAX_DIFF_READS} reads. Use the evidence already collected, confirm only the source needed for selected ranges, then submit the walkthrough.`,
        );
      }
      diffReads++;
      const out = await runCommand(
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
      if (sourceReads >= MAX_SOURCE_READS) {
        return toolText(
          `Source inspection budget reached after ${MAX_SOURCE_READS} reads. Submit using the verified ranges already collected; do not invent more.`,
        );
      }
      sourceReads++;
      const content = await runCommand(
        gitOut(["show", `${request.pin}:${params.path}`], request.root),
      );
      return toolText(numberedLines(params.path, content, params.from, params.to));
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
      if (rangeCount > MAX_CODE_RANGES) {
        return toolText(
          `The draft has ${rangeCount} code ranges; the hard maximum is ${MAX_CODE_RANGES}. Keep only the ranges needed for the review story, then submit the complete draft again.`,
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
    cwd: request.root,
    model,
    modelRuntime: pi.modelRuntime,
    resourceLoader: minimalResourceLoader(pi.coding, AUTHORING_SYSTEM_PROMPT),
    tools: [
      "list_pr_changes",
      "list_source_files",
      "read_pr_diff",
      "read_source",
      "submit_walkthrough",
    ],
    customTools: [listChanges, listSources, readDiff, readSource, submit],
    sessionManager: pi.coding.SessionManager.inMemory(request.root),
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

function minimalResourceLoader(coding: CodingAgentSdk, systemPrompt: string): ResourceLoader {
  return {
    getExtensions: () => ({
      extensions: [],
      errors: [],
      runtime: coding.createExtensionRuntime(),
    }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
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
