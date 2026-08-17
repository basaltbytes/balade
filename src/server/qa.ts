/** Generation-bound Q&A state machine and background clarification workflow. */

import {
  Cause,
  Clock,
  Context,
  Crypto,
  Effect,
  Exit,
  Layer,
  Option,
  Result,
  Schema,
  Semaphore,
  type Scope,
} from "effect";
import {
  AgentModelManager,
  type AgentModelConfigurationError,
  type AgentModelManagerPort,
  type AgentModelStatusError,
} from "../agent/model.js";
import {
  ContextResolver,
  type ContextResolverPort,
  type PullResolution,
  type ResolveContext,
} from "../contract/context.js";
import { QaGeneration as QaGenerationSchema, QaThreadId, QaTurnId } from "../contract/schema.js";
import type {
  Payload,
  QaAgentStatus,
  QaAskRequest,
  QaGeneration,
  QaQuestion,
  QaState,
  QaThread,
  QaTurn,
} from "../contract/types.js";
import {
  WalkthroughClarifier,
  type ClarificationRequest,
  type WalkthroughClarifierPort,
} from "../pi/clarifier.js";
import { getPreset } from "../preset/registry.js";
import { QaStateStore } from "../state.js";
import { sanitizeTerminalText } from "../terminal.js";
import { compileFragment, parseFragment } from "../walkthrough/fragment.js";
import { PayloadCache } from "./cache.js";
import { ServerRepo } from "./repo.js";

const decodeThreadId = Schema.decodeUnknownEffect(QaThreadId);
const decodeTurnId = Schema.decodeUnknownEffect(QaTurnId);

export class QaWalkthroughUnavailable extends Schema.TaggedErrorClass<QaWalkthroughUnavailable>()(
  "QaWalkthroughUnavailable",
  { path: Schema.String, cause: Schema.Defect() },
) {}

export class QaStateUnavailable extends Schema.TaggedErrorClass<QaStateUnavailable>()(
  "QaStateUnavailable",
  { path: Schema.String, cause: Schema.Defect() },
) {}

export class QaSectionNotFound extends Schema.TaggedErrorClass<QaSectionNotFound>()(
  "QaSectionNotFound",
  { sectionId: Schema.String },
) {}

export class QaThreadNotFound extends Schema.TaggedErrorClass<QaThreadNotFound>()(
  "QaThreadNotFound",
  { threadId: QaThreadId },
) {}

export class QaThreadBusy extends Schema.TaggedErrorClass<QaThreadBusy>()("QaThreadBusy", {
  threadId: QaThreadId,
}) {}

export class QaAgentUnavailable extends Schema.TaggedErrorClass<QaAgentUnavailable>()(
  "QaAgentUnavailable",
  { reason: Schema.Literals(["setup-cancelled", "setup-failed"]) },
) {}

export class QaIdentifierFailed extends Schema.TaggedErrorClass<QaIdentifierFailed>()(
  "QaIdentifierFailed",
  { cause: Schema.Defect() },
) {}

export class QaGenerationChanged extends Schema.TaggedErrorClass<QaGenerationChanged>()(
  "QaGenerationChanged",
  { expected: QaGenerationSchema, actual: QaGenerationSchema },
) {}

export type QaWorkflowError =
  | QaWalkthroughUnavailable
  | QaStateUnavailable
  | QaSectionNotFound
  | QaThreadNotFound
  | QaThreadBusy
  | QaAgentUnavailable
  | QaIdentifierFailed
  | QaGenerationChanged;

export interface QaWorkflowPort {
  readonly agentStatus: Effect.Effect<QaAgentStatus, QaAgentUnavailable>;
  readonly read: (path: string) => Effect.Effect<QaState, QaWorkflowError>;
  readonly ask: (path: string, request: QaAskRequest) => Effect.Effect<QaState, QaWorkflowError>;
}

export interface QaWorkflowOptions {
  readonly scope: Scope.Scope;
  readonly resolution?: PullResolution;
  readonly useGh?: boolean;
}

type ReadCurrent = (path: string, payload: Payload) => Effect.Effect<QaState, QaWorkflowError>;
type Persist = (path: string, state: QaState) => Effect.Effect<void, QaWorkflowError>;

interface QaRuntime {
  readonly options: QaWorkflowOptions;
  readonly resolver: ContextResolverPort;
  readonly clarifier: WalkthroughClarifierPort;
  readonly lock: Semaphore.Semaphore;
  readonly readCurrent: ReadCurrent;
  readonly persist: Persist;
}

interface PendingWork {
  readonly path: string;
  readonly payload: Payload;
  readonly pending: Extract<QaThread, { status: "pending" }>;
  readonly question: QaQuestion;
  readonly request: ClarificationRequest;
  readonly initialContext: ResolveContext;
}

interface QuestionKey {
  readonly path: string;
  readonly payload: Payload;
  readonly threadId: QaThread["id"];
  readonly question: QaQuestion;
}

type ClarificationFacets = { preset?: NonNullable<ClarificationRequest["preset"]> };

interface EnqueueWork {
  readonly path: string;
  readonly payload: Payload;
  readonly request: QaAskRequest;
  readonly threadId: QaThread["id"];
  readonly question: QaQuestion;
  readonly root: string;
  readonly source: string;
  readonly model: ClarificationRequest["model"];
  readonly initialContext: ResolveContext;
}

export class QaWorkflow extends Context.Service<QaWorkflow, QaWorkflowPort>()(
  "@balade/QaWorkflow",
) {
  static layer(options: QaWorkflowOptions) {
    return Layer.effect(
      QaWorkflow,
      Effect.gen(function* () {
        const payloads = yield* PayloadCache;
        const repo = yield* ServerRepo;
        const store = yield* QaStateStore;
        const resolver = yield* ContextResolver;
        const clarifier = yield* WalkthroughClarifier;
        const agentModels = yield* AgentModelManager;
        const crypto = yield* Crypto.Crypto;
        const lock = yield* Semaphore.make(1);
        const reconciledGenerations = new Set<string>();

        const loadPayload = Effect.fn("QaWorkflow.loadPayload")(function* (path: string) {
          const loaded = yield* payloads
            .get(path)
            .pipe(Effect.mapError((cause) => new QaWalkthroughUnavailable({ path, cause })));
          if (loaded.payload === null) {
            return yield* new QaWalkthroughUnavailable({
              path,
              cause: "The walkthrough no longer compiles.",
            });
          }
          return loaded.payload;
        });

        const persist = Effect.fn("QaWorkflow.persist")((path: string, state: QaState) =>
          store
            .write(path, state)
            .pipe(Effect.mapError((cause) => new QaStateUnavailable({ path, cause }))),
        );

        const readCurrent = Effect.fn("QaWorkflow.readCurrent")(function* (
          path: string,
          payload: Payload,
        ) {
          const stored = yield* store
            .read(path)
            .pipe(Effect.mapError((cause) => new QaStateUnavailable({ path, cause })));
          const current = Option.match(stored, {
            onNone: () => emptyState(path, payload),
            onSome: (state) =>
              state.pr === payload.pr.number && state.stamp === payload.commit
                ? state
                : emptyState(path, payload),
          });
          const key = generationKey(path, payload);
          if (reconciledGenerations.has(key)) return current;

          const reconciled = current.threads.some((thread) => thread.status === "pending")
            ? failPendingThreads(current, yield* isoNow())
            : current;
          if (reconciled !== current) yield* persist(path, reconciled);
          reconciledGenerations.add(key);
          return reconciled;
        });
        const runtime: QaRuntime = {
          options,
          resolver,
          clarifier,
          lock,
          readCurrent,
          persist,
        };

        const read = Effect.fn("QaWorkflow.read")((path: string) =>
          lock.withPermit(
            Effect.gen(function* () {
              const payload = yield* loadPayload(path);
              return yield* readCurrent(path, payload);
            }),
          ),
        );

        const agentStatus = readAgentStatus(agentModels);

        const loadRequestPayload = Effect.fn("QaWorkflow.loadRequestPayload")(function* (
          path: string,
          request: QaAskRequest,
        ) {
          const payload = yield* loadPayload(path);
          yield* requireGeneration(payload, request.generation);
          if (
            request.kind === "new" &&
            !payload.sections.some((section) => section.id === request.anchor.sectionId)
          ) {
            return yield* new QaSectionNotFound({ sectionId: request.anchor.sectionId });
          }
          return payload;
        });

        const ask = Effect.fn("QaWorkflow.ask")(function* (path: string, request: QaAskRequest) {
          yield* loadRequestPayload(path, request);
          const model = yield* agentModels.ensure.pipe(Effect.mapError(mapAgentSetupError));
          const payload = yield* loadRequestPayload(path, request);
          const prepared = yield* Effect.all(
            {
              source: repo
                .source(path)
                .pipe(Effect.mapError((cause) => new QaWalkthroughUnavailable({ path, cause }))),
              resolved: resolver
                .resolve(resolveOptions(options, repo.root, path, payload, []))
                .pipe(Effect.mapError((cause) => new QaWalkthroughUnavailable({ path, cause }))),
            },
            { concurrency: "unbounded" },
          );
          yield* loadRequestPayload(path, request);
          const now = isoNow();
          const questionId = yield* crypto.randomUUIDv4.pipe(
            Effect.flatMap(decodeTurnId),
            Effect.mapError((cause) => new QaIdentifierFailed({ cause })),
          );
          const threadId =
            request.kind === "new"
              ? yield* crypto.randomUUIDv4.pipe(
                  Effect.flatMap(decodeThreadId),
                  Effect.mapError((cause) => new QaIdentifierFailed({ cause })),
                )
              : request.threadId;
          const askedAt = yield* now;
          const question: QaQuestion = {
            id: questionId,
            question: request.question,
            askedAt,
          };

          return yield* enqueueQuestion(runtime, {
            path,
            payload,
            request,
            threadId,
            question,
            root: repo.root,
            source: prepared.source,
            model,
            initialContext: prepared.resolved.ctx,
          });
        });

        return { agentStatus, read, ask } satisfies QaWorkflowPort;
      }),
    );
  }
}

const enqueueQuestion = Effect.fn("QaWorkflow.enqueueQuestion")(function* (
  runtime: QaRuntime,
  work: EnqueueWork,
) {
  return yield* Effect.uninterruptible(
    Effect.gen(function* () {
      const pending = yield* runtime.lock.withPermit(
        Effect.gen(function* () {
          const current = yield* runtime.readCurrent(work.path, work.payload);
          const thread = yield* pendingThread(current, work.request, work.threadId, work.question);
          const state = {
            ...current,
            threads: replaceThread(current.threads, thread),
          } satisfies QaState;
          yield* runtime.persist(work.path, state);
          return { state, thread };
        }),
      );
      const preset = work.payload.preset === undefined ? undefined : getPreset(work.payload.preset);
      const clarificationFacets: ClarificationFacets = {};
      if (preset !== undefined) {
        clarificationFacets.preset = { name: preset.name, authoring: preset.authoring };
      }
      const request: ClarificationRequest = {
        root: work.root,
        pin: work.payload.commit,
        base: work.initialContext.baseSha,
        files: changedFiles(work.payload),
        headInstructionPolicy: "omit-changed",
        model: work.model,
        sourcePath: work.path,
        walkthroughSource: work.source,
        anchor: pending.thread.anchor,
        turns: pending.thread.turns,
        question: work.question.question,
        ...clarificationFacets,
      };
      const pendingWork = {
        path: work.path,
        payload: work.payload,
        pending: pending.thread,
        question: work.question,
        request,
        initialContext: work.initialContext,
      } satisfies PendingWork;
      const questionKey = {
        path: work.path,
        payload: work.payload,
        threadId: pending.thread.id,
        question: work.question,
      } satisfies QuestionKey;
      const failureContext = JSON.stringify({
        path: work.path,
        threadId: pending.thread.id,
        questionId: work.question.id,
        providerId: work.model.providerId,
        modelId: work.model.modelId,
      });
      const worker = completeQuestion(runtime, pendingWork).pipe(
        Effect.tapError((error) =>
          Effect.logError(
            sanitizeTerminalText(
              `balade: clarification failed (${error._tag}; ${failureContext}).`,
            ),
          ),
        ),
        Effect.tapDefect((defect) =>
          Effect.logError(
            sanitizeTerminalText(
              `balade: clarification failed unexpectedly.\n${Cause.pretty(Cause.die(defect))}`,
            ),
          ),
        ),
        Effect.onExit(
          Exit.match({
            onSuccess: () => Effect.void,
            onFailure: () =>
              markFailed(runtime, questionKey).pipe(
                Effect.catch((writeError) =>
                  Effect.logError(
                    sanitizeTerminalText(
                      `balade: clarification failure state could not be saved (${writeError._tag}; ${failureContext}).`,
                    ),
                  ),
                ),
              ),
          }),
        ),
        /* Expected clarification failures become the durable failed state above.
           Defects and interruption remain in the forked fiber's cause. */
        Effect.ignore,
      );
      yield* worker.pipe(
        Effect.forkIn(runtime.options.scope, {
          startImmediately: true,
          uninterruptible: false,
        }),
      );
      return pending.state;
    }),
  );
});

const compileAnswer = Effect.fn("QaWorkflow.compileAnswer")(function* (
  runtime: QaRuntime,
  work: PendingWork,
  raw: string,
) {
  const { path, payload, pending, request, initialContext } = work;
  const parsed = yield* Effect.fromResult(parseFragment(raw, path, payload.preset));
  const known = new Set(initialContext.files.map((file) => file.path));
  const context = parsed.references.every((reference) => known.has(reference))
    ? initialContext
    : (yield* runtime.resolver.resolve(
        resolveOptions(runtime.options, request.root, path, payload, parsed.references),
      )).ctx;
  const blocks = yield* Effect.fromResult(
    compileFragment(parsed, context, path, pending.anchor.sectionId),
  );
  return blocks;
});

const completeQuestion = Effect.fn("QaWorkflow.completeQuestion")(function* (
  runtime: QaRuntime,
  work: PendingWork,
) {
  const { path, payload, pending, question, request } = work;
  const blocks = yield* runtime.clarifier.answer(request, (candidate) =>
    compileAnswer(runtime, work, candidate).pipe(
      Effect.map(Result.succeed),
      Effect.catchTag("FragmentInvalid", (error) => Effect.succeed(Result.fail(error))),
    ),
  );
  const answeredAt = yield* isoNow();
  const turn: QaTurn = { ...question, answeredAt, answer: [...blocks] };

  yield* settleQuestion(
    runtime,
    { path, payload, threadId: pending.id, question },
    (active) =>
      ({
        id: active.id,
        anchor: active.anchor,
        status: "answered",
        turns: appendTurn(active.turns, turn),
      }) satisfies QaThread,
  );
});

const markFailed = Effect.fn("QaWorkflow.markFailed")(function* (
  runtime: QaRuntime,
  work: QuestionKey,
) {
  const { question } = work;
  const failedAt = yield* isoNow();
  yield* settleQuestion(
    runtime,
    work,
    (active) =>
      ({
        id: active.id,
        anchor: active.anchor,
        status: "failed",
        turns: active.turns,
        failed: question,
        failedAt,
      }) satisfies QaThread,
  );
});

type PendingThread = Extract<QaThread, { status: "pending" }>;

const settleQuestion = Effect.fn("QaWorkflow.settleQuestion")(function* (
  runtime: QaRuntime,
  key: QuestionKey,
  transition: (active: PendingThread) => QaThread,
) {
  yield* runtime.lock.withPermit(
    Effect.gen(function* () {
      const current = yield* runtime.readCurrent(key.path, key.payload);
      const active = current.threads.find((thread) => thread.id === key.threadId);
      if (active?.status !== "pending" || active.pending.id !== key.question.id) return;
      yield* runtime.persist(key.path, {
        ...current,
        threads: replaceThread(current.threads, transition(active)),
      });
    }),
  );
});

const pendingThread = Effect.fn("QaWorkflow.pendingThread")(function* (
  state: QaState,
  request: QaAskRequest,
  threadId: QaThread["id"],
  question: QaQuestion,
) {
  if (request.kind === "new") {
    return {
      id: threadId,
      anchor: request.anchor,
      status: "pending",
      turns: [],
      pending: question,
    } satisfies Extract<QaThread, { status: "pending" }>;
  }
  const current = state.threads.find((thread) => thread.id === request.threadId);
  if (current === undefined) return yield* new QaThreadNotFound({ threadId: request.threadId });
  if (current.status === "pending") return yield* new QaThreadBusy({ threadId: request.threadId });
  return {
    id: current.id,
    anchor: current.anchor,
    status: "pending",
    turns: current.turns,
    pending: question,
  } satisfies Extract<QaThread, { status: "pending" }>;
});

function replaceThread(threads: readonly QaThread[], replacement: QaThread): readonly QaThread[] {
  const index = threads.findIndex((thread) => thread.id === replacement.id);
  return index === -1
    ? [...threads, replacement]
    : threads.map((thread) => (thread.id === replacement.id ? replacement : thread));
}

function appendTurn(turns: readonly QaTurn[], turn: QaTurn): readonly [QaTurn, ...QaTurn[]] {
  const first = turns[0];
  return first === undefined ? [turn] : [first, ...turns.slice(1), turn];
}

function emptyState(path: string, payload: Payload): QaState {
  return {
    version: 1,
    walkthrough: path,
    pr: payload.pr.number,
    stamp: payload.commit,
    threads: [],
  };
}

function generationKey(path: string, payload: Payload): string {
  return `${path}\0${payload.pr.number}\0${payload.commit}`;
}

function failPendingThreads(state: QaState, failedAt: string): QaState {
  return {
    ...state,
    threads: state.threads.map(
      (thread): QaThread =>
        thread.status === "pending"
          ? {
              id: thread.id,
              anchor: thread.anchor,
              status: "failed",
              turns: thread.turns,
              failed: thread.pending,
              failedAt,
            }
          : thread,
    ),
  };
}

function requireGeneration(
  payload: Payload,
  expected: QaGeneration,
): Effect.Effect<void, QaGenerationChanged> {
  const actual = { pr: payload.pr.number, stamp: payload.commit } satisfies QaGeneration;
  return actual.pr === expected.pr && actual.stamp === expected.stamp
    ? Effect.void
    : new QaGenerationChanged({ expected, actual });
}

function changedFiles(payload: Payload): ClarificationRequest["files"] {
  return payload.files.map((file) => {
    const renamed = file.oldPath === undefined ? {} : { oldPath: file.oldPath };
    return {
      path: file.path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      ...renamed,
    };
  });
}

function resolveOptions(
  options: QaWorkflowOptions,
  root: string,
  path: string,
  payload: Payload,
  references: readonly string[],
) {
  const resolution = options.resolution === undefined ? {} : { resolution: options.resolution };
  const useGh = options.useGh === undefined ? {} : { useGh: options.useGh };
  return {
    cwd: root,
    pr: payload.pr.number,
    commit: payload.commit,
    file: path,
    references,
    ...resolution,
    ...useGh,
  };
}

const readAgentStatus = Effect.fn("QaWorkflow.readAgentStatus")(function* (
  models: AgentModelManagerPort,
) {
  const state = yield* models.status.pipe(Effect.mapError(mapAgentSetupError));
  return {
    status: state._tag === "AgentModelReady" ? "ready" : "setup-required",
  } satisfies QaAgentStatus;
});

function mapAgentSetupError(
  error: AgentModelConfigurationError | AgentModelStatusError,
): QaAgentUnavailable {
  return new QaAgentUnavailable({
    reason:
      error._tag === "LoginCancelled" || error._tag === "AgentModelSelectionCancelled"
        ? "setup-cancelled"
        : "setup-failed",
  });
}

const isoNow = (): Effect.Effect<string> =>
  Clock.currentTimeMillis.pipe(Effect.map((milliseconds) => new Date(milliseconds).toISOString()));
