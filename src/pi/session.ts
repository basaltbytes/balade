/** Shared Pi session preparation and inspection assembly for generation and clarification. */

import type {
  AgentSession,
  ModelRuntime,
  ResourceLoader,
  ToolDefinition,
  ToolExecutionEndEvent,
  ToolExecutionStartEvent,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { Effect, Option, Predicate, Result } from "effect";
import type { InspectionBudget } from "../authoring/package.js";
import type {
  AuthorChangedFile,
  AuthorDraft,
  AuthorStatus,
  AuthoringRequest,
  HeadInstructionPolicy,
} from "./author.js";
import { authoringSystemPrompt } from "./authoring.js";
import {
  createInspectionTools,
  installSearchConfiguration,
  toolText,
  writeSearchConfiguration,
  type PiInspectionRequest,
  type RunSessionEffect,
} from "./inspection.js";
import {
  loadPinnedProjectContext,
  type PinnedProjectContext,
  type ProjectContextFile,
} from "./project-context.js";
import { openPinnedRepositorySnapshot, type PinnedRepositorySnapshot } from "./snapshot.js";

export type CodingAgentSdk = typeof import("@earendil-works/pi-coding-agent");
export type AiSdk = typeof import("@earendil-works/pi-ai");

export interface PiSessionDependencies {
  readonly coding: CodingAgentSdk;
  readonly ai: AiSdk;
  readonly modelRuntime: ModelRuntime;
}

export type { RunSessionEffect } from "./inspection.js";

const SESSION_ABORT_TIMEOUT = "1 second";

export interface PiSessionPreparation {
  readonly snapshot: PinnedRepositorySnapshot;
  readonly projectContext: PinnedProjectContext;
  readonly searchConfiguration: string;
}

export interface PiSessionPreparationRequest {
  readonly root: string;
  readonly pin: string;
  readonly files: readonly AuthorChangedFile[];
  readonly headInstructionPolicy: HeadInstructionPolicy;
}

export const preparePiSession = Effect.fn("preparePiSession")(function* (
  request: PiSessionPreparationRequest,
  snapshotCacheRoot: string,
) {
  const changed = new Set(request.files.map((file) => file.path));
  const snapshot = yield* openPinnedRepositorySnapshot({
    cacheRoot: snapshotCacheRoot,
    repositoryRoot: request.root,
    pin: request.pin,
  });
  const prepared = yield* Effect.all(
    {
      projectContext: loadPinnedProjectContext(
        {
          pin: request.pin,
          changedPaths: changed,
          headInstructionPolicy: request.headInstructionPolicy,
        },
        snapshot,
      ),
      searchConfiguration: writeSearchConfiguration(snapshotCacheRoot),
    },
    { concurrency: "unbounded" },
  );
  return { snapshot, ...prepared } satisfies PiSessionPreparation;
});

export async function createPiSession(
  pi: PiSessionDependencies,
  model: Model<string>,
  request: AuthoringRequest,
  runSessionEffect: RunSessionEffect,
  preparation: PiSessionPreparation,
) {
  let draft: AuthorDraft | undefined;
  for (const notice of preparation.projectContext.notices) request.progress(notice);

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
      const presetFacet: DraftPresetFacet = {};
      if (params.preset !== undefined) presetFacet.preset = params.preset;
      draft = { title: params.title, meta: params.meta, body: params.body, ...presetFacet };
      return { ...toolText("Walkthrough draft received."), terminate: true };
    },
  });

  const created = await createInspectionSession(
    pi,
    model,
    request,
    runSessionEffect,
    preparation,
    (budget) => authoringSystemPrompt(budget, request.preset),
    submit,
  );
  const { session } = created;
  const activeTools = new Map<string, string>();
  const reportStatus = (status: AuthorStatus) =>
    request.progress({ _tag: "AuthorStatusChanged", status });
  const unsubscribe = session.subscribe((event) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_end" &&
      event.assistantMessageEvent.content !== ""
    ) {
      request.progress({
        _tag: "AuthorAssistantText",
        text: event.assistantMessageEvent.content,
      });
      return;
    }
    if (event.type === "tool_execution_start") {
      activeTools.set(event.toolCallId, event.toolName);
      reportStatus({ _tag: "AuthorUsingTool", name: event.toolName });
      request.progress({
        _tag: "AuthorToolStarted",
        name: event.toolName,
        input: verboseValue(event.args),
      });
      return;
    }
    if (event.type === "tool_execution_end") {
      activeTools.delete(event.toolCallId);
      const stillRunning = [...activeTools.values()].at(-1);
      reportStatus(
        stillRunning === undefined
          ? { _tag: "AuthorGenerating" }
          : { _tag: "AuthorUsingTool", name: stillRunning },
      );
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
    beginTurn: () => {
      activeTools.clear();
      reportStatus({ _tag: "AuthorGenerating" });
    },
    clearDraft: () => {
      draft = undefined;
    },
    resetInspectionBudget: created.resetInspectionBudget,
    getDraft: () => draft,
  };
}

/**
 * The single Pi sandbox assembly path. Each workflow supplies only its prompt
 * and terminating submit tool; the pinned inspection allowlist and in-memory
 * session policy cannot drift between generation and clarification.
 */
export async function createInspectionSession(
  pi: PiSessionDependencies,
  model: Model<string>,
  request: PiInspectionRequest,
  runSessionEffect: RunSessionEffect,
  preparation: PiSessionPreparation,
  systemPrompt: (budget: InspectionBudget) => string,
  submit: ToolDefinition,
) {
  await runSessionEffect(installSearchConfiguration(preparation.searchConfiguration));
  const inspection = await createInspectionTools(
    pi,
    request,
    runSessionEffect,
    preparation.snapshot,
  );
  const tools: ToolDefinition[] = [...inspection.tools, submit];
  const { session } = await pi.coding.createAgentSession({
    cwd: preparation.snapshot.root,
    model,
    modelRuntime: pi.modelRuntime,
    resourceLoader: minimalResourceLoader(
      pi.coding,
      systemPrompt(inspection.budget),
      preparation.projectContext.files,
    ),
    tools: tools.map((tool) => tool.name),
    customTools: tools,
    sessionManager: pi.coding.SessionManager.inMemory(preparation.snapshot.root),
    settingsManager: pi.coding.SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false },
    }),
  });
  return { session, resetInspectionBudget: inspection.reset };
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

type DraftPresetFacet = { preset?: string };

/* The SDK declares tool args and results as any; these render them for the
   verbose progress log without trusting them further. */
function verboseValue(value: ToolExecutionStartEvent["args"]): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function verboseToolOutput(result: ToolExecutionEndEvent["result"]): string {
  if (!Predicate.isObject(result) || !("content" in result)) return verboseValue(result);
  const content = result.content;
  if (!Array.isArray(content)) return verboseValue(result);
  return content
    .map((block) =>
      Predicate.isObject(block) &&
      "type" in block &&
      block.type === "text" &&
      "text" in block &&
      Predicate.isString(block.text)
        ? block.text
        : verboseValue(block),
    )
    .join("\n");
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
