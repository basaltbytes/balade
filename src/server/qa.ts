/** Generation-bound Q&A state machine and background clarification workflow. */

import {
  Clock,
  Context,
  Crypto,
  Effect,
  Layer,
  Match,
  Option,
  Schema,
  Scope,
  Semaphore,
} from "effect";
import {
  ContextResolver,
  type ContextResolverPort,
  type PullResolution,
  type ResolveContext,
} from "../contract/context.js";
import { QaThreadId, QaTurnId } from "../contract/schema.js";
import type {
  Payload,
  QaAskRequest,
  QaQuestion,
  QaState,
  QaThread,
  QaTurn,
} from "../contract/types.js";
import {
  WalkthroughClarifier,
  type ClarificationRequest,
  type ClarifierSetupError,
  type WalkthroughClarifierPort,
} from "../pi/clarifier.js";
import { QaStateStore } from "../state.js";
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
  { reason: Schema.Literals(["model-not-configured", "model-unavailable", "setup-failed"]) },
) {}

export class QaIdentifierFailed extends Schema.TaggedErrorClass<QaIdentifierFailed>()(
  "QaIdentifierFailed",
  { cause: Schema.Defect() },
) {}

export type QaWorkflowError =
  | QaWalkthroughUnavailable
  | QaStateUnavailable
  | QaSectionNotFound
  | QaThreadNotFound
  | QaThreadBusy
  | QaAgentUnavailable
  | QaIdentifierFailed;

export interface QaWorkflowPort {
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

interface FailedWork {
  readonly path: string;
  readonly payload: Payload;
  readonly threadId: QaThread["id"];
  readonly question: QaQuestion;
}

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
        const crypto = yield* Crypto.Crypto;
        const lock = yield* Semaphore.make(1);

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

        const readCurrent = Effect.fn("QaWorkflow.readCurrent")(function* (
          path: string,
          payload: Payload,
        ) {
          const stored = yield* store
            .read(path)
            .pipe(Effect.mapError((cause) => new QaStateUnavailable({ path, cause })));
          return Option.match(stored, {
            onNone: () => emptyState(path, payload),
            onSome: (state) =>
              state.pr === payload.pr.number && state.stamp === payload.commit
                ? state
                : emptyState(path, payload),
          });
        });

        const persist = Effect.fn("QaWorkflow.persist")((path: string, state: QaState) =>
          store
            .write(path, state)
            .pipe(Effect.mapError((cause) => new QaStateUnavailable({ path, cause }))),
        );
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

        const ask = Effect.fn("QaWorkflow.ask")(function* (path: string, request: QaAskRequest) {
          const payload = yield* loadPayload(path);
          if (
            request.kind === "new" &&
            !payload.sections.some((section) => section.id === request.anchor.sectionId)
          ) {
            return yield* new QaSectionNotFound({ sectionId: request.anchor.sectionId });
          }
          const prepared = yield* Effect.all(
            {
              source: repo
                .source(path)
                .pipe(Effect.mapError((cause) => new QaWalkthroughUnavailable({ path, cause }))),
              model: clarifier.selectedModel.pipe(Effect.mapError(mapSetupError)),
              resolved: resolver
                .resolve(resolveOptions(options, repo.root, path, payload, []))
                .pipe(Effect.mapError((cause) => new QaWalkthroughUnavailable({ path, cause }))),
            },
            { concurrency: "unbounded" },
          );
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
            model: prepared.model,
            initialContext: prepared.resolved.ctx,
          });
        });

        return { read, ask } satisfies QaWorkflowPort;
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
      };
      const pendingWork = {
        path: work.path,
        payload: work.payload,
        pending: pending.thread,
        question: work.question,
        request,
        initialContext: work.initialContext,
      } satisfies PendingWork;
      const failedWork = {
        path: work.path,
        payload: work.payload,
        threadId: pending.thread.id,
        question: work.question,
      } satisfies FailedWork;
      const failureGuard = yield* Scope.fork(runtime.options.scope);
      yield* Scope.addFinalizer(
        failureGuard,
        markFailed(runtime, failedWork).pipe(
          Effect.catch((writeError) =>
            Effect.logError(
              `balade: clarification failure state could not be saved (${writeError._tag}).`,
            ),
          ),
        ),
      );
      const worker = completeQuestion(runtime, pendingWork).pipe(
        Effect.tapCause(() => Effect.logError("balade: clarification failed.")),
        Effect.onExit((exit) => Scope.close(failureGuard, exit)),
        Effect.ignoreCause,
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

const completeQuestion = Effect.fn("QaWorkflow.completeQuestion")(function* (
  runtime: QaRuntime,
  work: PendingWork,
) {
  const { path, payload, pending, question, request, initialContext } = work;
  const raw = yield* runtime.clarifier.answer(request);
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
  const answeredAt = yield* isoNow();
  const turn: QaTurn = { ...question, answeredAt, answer: [...blocks] };

  yield* runtime.lock.withPermit(
    Effect.gen(function* () {
      const current = yield* runtime.readCurrent(path, payload);
      const active = current.threads.find((thread) => thread.id === pending.id);
      if (active?.status !== "pending" || active.pending.id !== question.id) return;
      const completed = appendTurn(active.turns, turn);
      const answered = {
        id: active.id,
        anchor: active.anchor,
        status: "answered",
        turns: completed,
      } satisfies QaThread;
      yield* runtime.persist(path, {
        ...current,
        threads: replaceThread(current.threads, answered),
      });
    }),
  );
});

const markFailed = Effect.fn("QaWorkflow.markFailed")(function* (
  runtime: QaRuntime,
  work: FailedWork,
) {
  const { path, payload, threadId, question } = work;
  const failedAt = yield* isoNow();
  yield* runtime.lock.withPermit(
    Effect.gen(function* () {
      const current = yield* runtime.readCurrent(path, payload);
      const active = current.threads.find((thread) => thread.id === threadId);
      if (active?.status !== "pending" || active.pending.id !== question.id) return;
      const failed = {
        id: active.id,
        anchor: active.anchor,
        status: "failed",
        turns: active.turns,
        failed: question,
        failedAt,
      } satisfies QaThread;
      yield* runtime.persist(path, {
        ...current,
        threads: replaceThread(current.threads, failed),
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

function mapSetupError(error: ClarifierSetupError): QaAgentUnavailable {
  return Match.valueTags(error, {
    ClarifierModelNotConfigured: () => new QaAgentUnavailable({ reason: "model-not-configured" }),
    ClarifierModelUnavailable: () => new QaAgentUnavailable({ reason: "model-unavailable" }),
    ClarifierPreferenceReadFailed: () => new QaAgentUnavailable({ reason: "setup-failed" }),
    ClarifierRuntimeLoadFailed: () => new QaAgentUnavailable({ reason: "setup-failed" }),
  });
}

const isoNow = (): Effect.Effect<string> =>
  Clock.currentTimeMillis.pipe(Effect.map((milliseconds) => new Date(milliseconds).toISOString()));
