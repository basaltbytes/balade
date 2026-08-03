/** Pi 0.83 adapter. The package is loaded only when a generation method runs. */

import type { AgentSession, ModelRuntime, ResourceLoader } from "@earendil-works/pi-coding-agent";
import type { AuthEvent, AuthPrompt, Model } from "@earendil-works/pi-ai";
import Markdoc from "@markdoc/markdoc";
import type { Node } from "@markdoc/markdoc";
import {
  Context,
  Effect,
  Layer,
  Option,
  Redacted,
  Result,
  Schema,
  Semaphore,
  Terminal,
} from "effect";
import { describeFailure } from "../failure.js";
import { CommandExecutor, gitOut } from "../resolve/exec.js";
import {
  AuthorDiscoveryFailed,
  AuthorDraft,
  AuthorLoginMethod,
  AuthorModel,
  AuthorSessionStartFailed,
  AuthorUsage,
  DraftMalformed,
  LoginCancelled,
  LoginFailed,
  ProviderRequestFailed,
  WalkthroughAuthor,
  type AuthoringRequest,
  type AuthoringSession,
  type AuthorLoginMethod as AuthorLoginMethodType,
  type LoginInteraction,
  type LoginNotification,
  type LoginPrompt,
  type LoginSecretPrompt,
} from "./author.js";
import {
  AUTHORING_SYSTEM_PROMPT,
  initialAuthoringPrompt,
  repairAuthoringPrompt,
} from "./prompt.js";

type CodingAgentSdk = typeof import("@earendil-works/pi-coding-agent");
type AiSdk = typeof import("@earendil-works/pi-ai");

export interface PiAdapterDependencies {
  readonly coding: CodingAgentSdk;
  readonly ai: AiSdk;
  readonly modelRuntime: ModelRuntime;
}

export interface PiWalkthroughAuthorOptions {
  /** Explicit injection keeps adapter tests on Pi's faux provider and in-memory stores. */
  readonly load?: () => Promise<PiAdapterDependencies>;
}

type CommandDependencies = CommandExecutor;

const decodeModels = Schema.decodeUnknownEffect(Schema.Array(AuthorModel), {
  onExcessProperty: "error",
});
const decodeLoginMethods = Schema.decodeUnknownEffect(Schema.Array(AuthorLoginMethod), {
  onExcessProperty: "error",
});
const decodeDraft = Schema.decodeUnknownEffect(AuthorDraft, { onExcessProperty: "error" });
const decodeUsage = Schema.decodeUnknownEffect(AuthorUsage, { onExcessProperty: "error" });

const MAX_TREE_FILES = 2_000;
const MAX_SOURCE_LINES = 400;
const MAX_DIFF_LINES = 800;
const MAX_TOOL_CHARACTERS = 80_000;
const MAX_DIFF_READS = 8;
const MAX_SOURCE_READS = 12;
const MAX_CODE_RANGES = 10;
const SESSION_ABORT_TIMEOUT = "1 second";

interface RawLoginMethod {
  readonly providerId: string;
  readonly providerName: string;
  readonly method: "oauth" | "api_key";
  readonly label: string;
  readonly billing: "standard" | "anthropic-extra-usage";
}

async function loadLiveDependencies(): Promise<PiAdapterDependencies> {
  const [coding, ai] = await Promise.all([
    import("@earendil-works/pi-coding-agent"),
    import("@earendil-works/pi-ai"),
  ]);
  return { coding, ai, modelRuntime: await coding.ModelRuntime.create() };
}

/** Inert until a method calls `dependencies`; check/open/build never import Pi. */
export function piWalkthroughAuthorLayer(options: PiWalkthroughAuthorOptions = {}) {
  return Layer.effect(
    WalkthroughAuthor,
    Effect.gen(function* () {
      const commandContext = Context.pick(CommandExecutor)(
        yield* Effect.context<CommandDependencies>(),
      );
      const runCommand = Effect.runPromiseWith(commandContext);
      let loaded: Promise<PiAdapterDependencies> | undefined;
      const load = options.load ?? loadLiveDependencies;
      const dependencies = () => (loaded ??= load());

      const availableModels = Effect.gen(function* () {
        const raw = yield* Effect.tryPromise({
          try: async () => {
            const { modelRuntime } = await dependencies();
            const models = await modelRuntime.getAvailable();
            return models
              .map((model) => {
                const provider = modelRuntime.getProvider(model.provider);
                return {
                  providerId: model.provider,
                  providerName: provider?.name ?? model.provider,
                  modelId: model.id,
                  modelName: model.name,
                };
              })
              .sort((left, right) =>
                `${left.providerName}/${left.modelName}`.localeCompare(
                  `${right.providerName}/${right.modelName}`,
                ),
              );
          },
          catch: (cause) => new AuthorDiscoveryFailed({ cause }),
        });
        return yield* decodeModels(raw).pipe(
          Effect.mapError((cause) => new AuthorDiscoveryFailed({ cause })),
        );
      }).pipe(Effect.withSpan("WalkthroughAuthor.availableModels"));

      const loginMethods = Effect.gen(function* () {
        const raw = yield* Effect.tryPromise({
          try: async () => {
            const { modelRuntime } = await dependencies();
            return modelRuntime.getProviders().flatMap((provider) => {
              const methods: RawLoginMethod[] = [];
              if (provider.auth.oauth !== undefined) {
                methods.push({
                  providerId: provider.id,
                  providerName: provider.name,
                  method: "oauth",
                  label: provider.auth.oauth.name,
                  billing: provider.id === "anthropic" ? "anthropic-extra-usage" : "standard",
                });
              }
              if (provider.auth.apiKey?.login !== undefined) {
                methods.push({
                  providerId: provider.id,
                  providerName: provider.name,
                  method: "api_key",
                  label: provider.auth.apiKey.name,
                  billing: "standard",
                });
              }
              return methods;
            });
          },
          catch: (cause) => new AuthorDiscoveryFailed({ cause }),
        });
        const methods = yield* decodeLoginMethods(raw).pipe(
          Effect.mapError((cause) => new AuthorDiscoveryFailed({ cause })),
        );
        return [...methods].sort((left, right) =>
          `${left.providerName}/${left.method}`.localeCompare(
            `${right.providerName}/${right.method}`,
          ),
        );
      }).pipe(Effect.withSpan("WalkthroughAuthor.loginMethods"));

      const login = Effect.fn("WalkthroughAuthor.login")(function* (
        method: AuthorLoginMethodType,
        interaction: LoginInteraction,
      ) {
        return yield* Effect.tryPromise({
          try: async (signal) => {
            const { modelRuntime } = await dependencies();
            await modelRuntime.login(method.providerId, method.method, {
              signal,
              prompt: async (prompt) => {
                const mapped = mapLoginPrompt(prompt);
                return mapped.type === "secret"
                  ? Redacted.value(await interaction.secret(mapped))
                  : interaction.prompt(mapped);
              },
              notify: (event) => interaction.notify(mapLoginNotification(event)),
            });
          },
          catch: (cause) =>
            Terminal.isQuitError(cause)
              ? new LoginCancelled()
              : new LoginFailed({
                  provider: method.providerId,
                  method: method.method,
                  reason: modelsErrorCode(cause),
                }),
        });
      });

      const start = Effect.fn("WalkthroughAuthor.start")(function* (request: AuthoringRequest) {
        const acquired = yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: async () => {
              const pi = await dependencies();
              const model = pi.modelRuntime.getModel(
                request.model.providerId,
                request.model.modelId,
              );
              if (model === undefined) {
                throw new Error(
                  `Model ${request.model.providerId}/${request.model.modelId} is no longer available.`,
                );
              }
              return createPiSession(pi, model, request, runCommand);
            },
            catch: (cause) =>
              new AuthorSessionStartFailed({
                provider: request.model.providerId,
                model: request.model.modelId,
                cause,
              }),
          }),
          ({ session, unsubscribe }) =>
            Effect.gen(function* () {
              unsubscribe();
              yield* releaseSession(session);
            }),
        );
        const semaphore = yield* Semaphore.make(1);

        const turn = Effect.fn("PiAuthoringSession.turn")((invoke: () => Promise<void>) =>
          semaphore.withPermit(
            Effect.gen(function* () {
              acquired.clearDraft();
              acquired.resetInspectionBudget();
              const invocation = yield* Effect.result(
                Effect.tryPromise({
                  try: invoke,
                  catch: (cause) =>
                    new ProviderRequestFailed({
                      provider: request.model.providerId,
                      model: request.model.modelId,
                      detail: describeFailure(cause),
                    }),
                }),
              );

              const usage = yield* readUsage(acquired.session);
              request.progress({ _tag: "AuthorUsageUpdated", usage });

              if (Result.isFailure(invocation)) return yield* invocation.failure;

              const providerError = acquired.session.state.errorMessage;
              if (providerError !== undefined && providerError !== "") {
                return yield* new ProviderRequestFailed({
                  provider: request.model.providerId,
                  model: request.model.modelId,
                  detail: providerError,
                });
              }

              const rawDraft = acquired.getDraft();
              if (rawDraft === undefined) {
                return yield* new DraftMalformed({
                  detail: "The authoring agent finished without calling submit_walkthrough.",
                });
              }
              const draft = yield* decodeDraft(rawDraft).pipe(
                Effect.mapError(
                  () =>
                    new DraftMalformed({
                      detail: "The submitted walkthrough did not match the authoring contract.",
                    }),
                ),
              );
              if (hasEnvelopeOrFence(draft.body)) {
                return yield* new DraftMalformed({
                  detail: "The submitted body must not contain frontmatter or an outer code fence.",
                });
              }
              return { draft, usage };
            }),
          ),
        );

        const initial = yield* turn(() => acquired.session.prompt(initialAuthoringPrompt(request)));

        return {
          initial,
          repair: Effect.fn("PiAuthoringSession.repair")((feedback: string) =>
            turn(() => acquired.session.prompt(repairAuthoringPrompt(feedback))),
          ),
        } satisfies AuthoringSession;
      });

      return { availableModels, loginMethods, login, start };
    }),
  );
}

async function createPiSession(
  pi: PiAdapterDependencies,
  model: Model<string>,
  request: AuthoringRequest,
  runCommand: <A, E>(effect: Effect.Effect<A, E, CommandDependencies>) => Promise<A>,
) {
  let draft: unknown;
  let diffReads = 0;
  let sourceReads = 0;
  const sourcePaths = memoize(async () => {
    const out = await runCommand(
      gitOut(["ls-tree", "-r", "--name-only", "-z", request.pin], request.root),
    );
    return out.split("\0").filter((path) => path !== "");
  });
  const changed = new Set(request.files.map((file) => file.path));

  const listChanges = pi.coding.defineTool({
    name: "list_pr_changes",
    label: "List PR changes",
    description: "List every changed file and its status at the pinned pull-request commit.",
    parameters: pi.ai.Type.Object({}),
    execute: async () => ({
      content: [
        {
          type: "text" as const,
          text: limitCharacters(
            request.files
              .map(
                (file) =>
                  `${file.status}\t+${file.additions}\t-${file.deletions}\t${file.path}${
                    file.oldPath === undefined ? "" : `\tfrom ${file.oldPath}`
                  }`,
              )
              .join("\n") || "No changed files.",
          ),
        },
      ],
      details: {},
    }),
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
      return {
        content: [
          {
            type: "text" as const,
            text: limitCharacters(`${visible.join("\n")}${suffix}`),
          },
        ],
        details: {},
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
      return {
        content: [
          {
            type: "text" as const,
            text: paginateLines(out, params.from, params.to, MAX_DIFF_LINES),
          },
        ],
        details: {},
      };
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
      const lines = content.split("\n");
      if (lines.at(-1) === "") lines.pop();
      const from = params.from ?? 1;
      const requestedTo = params.to ?? Math.min(lines.length, from + MAX_SOURCE_LINES - 1);
      const to = Math.min(requestedTo, lines.length, from + MAX_SOURCE_LINES - 1);
      if (from > lines.length || from > to) {
        throw new Error(
          `${params.path} has ${lines.length} lines; requested ${from}-${requestedTo}.`,
        );
      }
      const width = String(to).length;
      const numbered = lines
        .slice(from - 1, to)
        .map((line, index) => `${String(from + index).padStart(width)} | ${line}`)
        .join("\n");
      const suffix = requestedTo > to ? `\n… capped at ${MAX_SOURCE_LINES} lines.` : "";
      return {
        content: [{ type: "text" as const, text: limitCharacters(`${numbered}${suffix}`) }],
        details: {},
      };
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
        content: [{ type: "text" as const, text: "Walkthrough draft received." }],
        details: {},
        terminate: true,
      };
    },
  });

  const resourceLoader = minimalResourceLoader(pi.coding, AUTHORING_SYSTEM_PROMPT);
  const { session } = await pi.coding.createAgentSession({
    cwd: request.root,
    model,
    modelRuntime: pi.modelRuntime,
    resourceLoader,
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
    if (event.type === "tool_execution_start") {
      request.progress({ _tag: "AuthorToolStarted", name: event.toolName });
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

function mapLoginPrompt(prompt: AuthPrompt): LoginPrompt | LoginSecretPrompt {
  const signal = prompt.signal === undefined ? {} : { signal: prompt.signal };
  if (prompt.type === "select") {
    return {
      type: "select",
      message: prompt.message,
      options: prompt.options.map((option) => ({
        id: option.id,
        label: option.label,
        ...(option.description === undefined ? {} : { description: option.description }),
      })),
      ...signal,
    };
  }
  return {
    type: prompt.type,
    message: prompt.message,
    ...(prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder }),
    ...signal,
  };
}

function mapLoginNotification(event: AuthEvent): LoginNotification {
  switch (event.type) {
    case "info":
      return {
        type: "info",
        message: event.message,
        links: (event.links ?? []).map((link) => ({
          url: link.url,
          ...(link.label === undefined ? {} : { label: link.label }),
        })),
      };
    case "auth_url":
      return {
        type: "auth_url",
        url: event.url,
        ...(event.instructions === undefined ? {} : { instructions: event.instructions }),
      };
    case "device_code":
      return {
        type: "device_code",
        userCode: event.userCode,
        verificationUri: event.verificationUri,
        ...(event.intervalSeconds === undefined ? {} : { intervalSeconds: event.intervalSeconds }),
        ...(event.expiresInSeconds === undefined
          ? {}
          : { expiresInSeconds: event.expiresInSeconds }),
      };
    case "progress":
      return { type: "progress", message: event.message };
  }
}

function modelsErrorCode(cause: unknown): "oauth" | "auth" | "provider" | "unknown" {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return "unknown";
  const code = cause.code;
  return code === "oauth" || code === "auth" || code === "provider" ? code : "unknown";
}

function releaseSession(session: AgentSession): Effect.Effect<void> {
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

function hasEnvelopeOrFence(body: string): boolean {
  const trimmed = body.trimStart();
  return trimmed.startsWith("---") || trimmed.startsWith("```");
}

const readUsage = Effect.fn("PiAuthoringSession.readUsage")(function* (session: AgentSession) {
  const stats = session.getSessionStats();
  return yield* decodeUsage({
    input: stats.tokens.input,
    output: stats.tokens.output,
    cacheRead: stats.tokens.cacheRead,
    cacheWrite: stats.tokens.cacheWrite,
    total: stats.tokens.total,
    cost: stats.cost,
  }).pipe(
    Effect.mapError(() => new DraftMalformed({ detail: "Pi returned malformed usage totals." })),
  );
});

function paginateLines(
  value: string,
  requestedFrom: number | undefined,
  requestedTo: number | undefined,
  maximum: number,
): string {
  const lines = value.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const from = requestedFrom ?? 1;
  const requestedEnd = requestedTo ?? Math.min(lines.length, from + maximum - 1);
  const to = Math.min(requestedEnd, lines.length, from + maximum - 1);
  if (from > lines.length || from > to) {
    throw new Error(`Diff has ${lines.length} lines; requested ${from}-${requestedEnd}.`);
  }
  const width = String(to).length;
  const page = lines
    .slice(from - 1, to)
    .map((line, index) => `${String(from + index).padStart(width)} | ${line}`)
    .join("\n");
  const more = lines.length - to;
  const suffix = more > 0 ? `\n… ${more} more lines; continue at line ${to + 1}.` : "";
  return limitCharacters(`${page}${suffix}`);
}

function limitCharacters(value: string): string {
  return value.length <= MAX_TOOL_CHARACTERS
    ? value
    : `${value.slice(0, MAX_TOOL_CHARACTERS)}\n… output capped at ${MAX_TOOL_CHARACTERS} characters.`;
}

function memoize<A>(load: () => Promise<A>): () => Promise<A> {
  let value: Promise<A> | undefined;
  return () => (value ??= load());
}

export const piWalkthroughAuthorLive = piWalkthroughAuthorLayer();
