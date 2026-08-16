/** Effect port and Pi adapter for one stateless clarification answer. */

import type { Model } from "@earendil-works/pi-ai";
import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { AUTHORING_TAG_CATALOG } from "../authoring/catalog.js";
import type { InspectionTier } from "../authoring/package.js";
import { plainHeadings, proseTemplate, renderProse } from "../authoring/prose.js";
import type { QaAnchor, QaTurn } from "../contract/types.js";
import { describeFailure } from "../failure.js";
import { CommandExecutor } from "../shell.js";
import { baladeSnapshotCacheDirectory } from "../state.js";
import {
  AuthorModel,
  AuthorModelId,
  AuthorModelPreference,
  AuthorProviderId,
  type AuthoringPreset,
  type AuthorSearchConfigurationFailed,
  type AuthorChangedFile,
  type HeadInstructionPolicy,
} from "./author.js";
import { loadLiveDependencies, type PiAdapterDependencies } from "./client.js";
import { toolText } from "./inspection.js";
import {
  createInspectionSession,
  hasEnvelopeOrFence,
  preparePiSession,
  releasePiSession,
  type PiSessionPreparation,
  type RunSessionEffect,
} from "./session.js";
import type { SnapshotOpenFailed, SnapshotPathRejected, SnapshotReadFailed } from "./snapshot.js";

export interface ClarificationRequest {
  readonly root: string;
  readonly pin: string;
  readonly base: string;
  readonly files: readonly AuthorChangedFile[];
  readonly budget?: InspectionTier;
  readonly preset?: AuthoringPreset;
  readonly headInstructionPolicy: HeadInstructionPolicy;
  readonly model: AuthorModel;
  readonly sourcePath: string;
  readonly walkthroughSource: string;
  readonly anchor: QaAnchor;
  readonly turns: readonly QaTurn[];
  readonly question: string;
  readonly repair?: ClarificationRepair;
}

export interface ClarificationRepair {
  readonly rejectedAnswer: string;
  readonly diagnostics: readonly string[];
}

export class ClarifierRuntimeLoadFailed extends Schema.TaggedErrorClass<ClarifierRuntimeLoadFailed>()(
  "ClarifierRuntimeLoadFailed",
  { cause: Schema.Defect() },
) {}

export class ClarifierPreferenceReadFailed extends Schema.TaggedErrorClass<ClarifierPreferenceReadFailed>()(
  "ClarifierPreferenceReadFailed",
  { cause: Schema.Defect() },
) {}

export class ClarifierModelNotConfigured extends Schema.TaggedErrorClass<ClarifierModelNotConfigured>()(
  "ClarifierModelNotConfigured",
  {},
) {}

export class ClarifierModelUnavailable extends Schema.TaggedErrorClass<ClarifierModelUnavailable>()(
  "ClarifierModelUnavailable",
  { provider: AuthorProviderId, model: AuthorModelId },
) {}

export class ClarifierSessionStartFailed extends Schema.TaggedErrorClass<ClarifierSessionStartFailed>()(
  "ClarifierSessionStartFailed",
  { provider: AuthorProviderId, model: AuthorModelId, cause: Schema.Defect() },
) {}

export class ClarifierRequestFailed extends Schema.TaggedErrorClass<ClarifierRequestFailed>()(
  "ClarifierRequestFailed",
  { provider: AuthorProviderId, model: AuthorModelId, detail: Schema.String },
) {}

export class ClarifierAnswerMalformed extends Schema.TaggedErrorClass<ClarifierAnswerMalformed>()(
  "ClarifierAnswerMalformed",
  { detail: Schema.String },
) {}

export type ClarifierSetupError =
  | ClarifierRuntimeLoadFailed
  | ClarifierPreferenceReadFailed
  | ClarifierModelNotConfigured
  | ClarifierModelUnavailable;

export type ClarifierRunError =
  | ClarifierRuntimeLoadFailed
  | ClarifierModelUnavailable
  | ClarifierSessionStartFailed
  | ClarifierRequestFailed
  | ClarifierAnswerMalformed
  | AuthorSearchConfigurationFailed
  | SnapshotOpenFailed
  | SnapshotPathRejected
  | SnapshotReadFailed;

export interface WalkthroughClarifierPort {
  readonly selectedModel: Effect.Effect<AuthorModel, ClarifierSetupError>;
  readonly answer: (request: ClarificationRequest) => Effect.Effect<string, ClarifierRunError>;
}

export class WalkthroughClarifier extends Context.Service<
  WalkthroughClarifier,
  WalkthroughClarifierPort
>()("@balade/WalkthroughClarifier") {}

export interface PiWalkthroughClarifierOptions {
  readonly load?: () => Promise<PiAdapterDependencies>;
  readonly snapshotCacheRoot?: string;
}

type SessionDependencies = CommandExecutor | FileSystem.FileSystem | Path.Path;

const decodeModel = Schema.decodeUnknownEffect(AuthorModel, { onExcessProperty: "error" });
const decodePreference = Schema.decodeUnknownEffect(AuthorModelPreference, {
  onExcessProperty: "error",
});

export function piWalkthroughClarifierLayer(options: PiWalkthroughClarifierOptions = {}) {
  return Layer.effect(
    WalkthroughClarifier,
    Effect.gen(function* () {
      const sessionContext = Context.pick(
        FileSystem.FileSystem,
        Path.Path,
        CommandExecutor,
      )(yield* Effect.context<SessionDependencies>());
      const runSessionEffect = Effect.runPromiseWith(sessionContext);
      const snapshotCacheRoot = options.snapshotCacheRoot ?? baladeSnapshotCacheDirectory();
      let loaded: Promise<PiAdapterDependencies> | undefined;
      const load = options.load ?? loadLiveDependencies;
      const dependencies = () => (loaded ??= load());

      const selectedModel = Effect.gen(function* () {
        const pi = yield* Effect.tryPromise({
          try: dependencies,
          catch: (cause) => new ClarifierRuntimeLoadFailed({ cause }),
        });
        const rawPreference = yield* Effect.tryPromise({
          try: async () => {
            await pi.settingsManager.flush();
            const failure = pi.settingsManager.drainErrors()[0]?.error;
            if (failure !== undefined) throw failure;
            const providerId = pi.settingsManager.getDefaultProvider();
            const modelId = pi.settingsManager.getDefaultModel();
            return providerId === undefined || modelId === undefined
              ? undefined
              : { providerId, modelId };
          },
          catch: (cause) => new ClarifierPreferenceReadFailed({ cause }),
        });
        if (rawPreference === undefined) return yield* new ClarifierModelNotConfigured();
        const preference = yield* decodePreference(rawPreference).pipe(
          Effect.mapError((cause) => new ClarifierPreferenceReadFailed({ cause })),
        );
        const model = pi.modelRuntime.getModel(preference.providerId, preference.modelId);
        if (model === undefined) {
          return yield* new ClarifierModelUnavailable({
            provider: preference.providerId,
            model: preference.modelId,
          });
        }
        const provider = pi.modelRuntime.getProvider(model.provider);
        return yield* decodeModel({
          providerId: model.provider,
          providerName: provider?.name ?? model.provider,
          modelId: model.id,
          modelName: model.name,
        }).pipe(Effect.mapError((cause) => new ClarifierPreferenceReadFailed({ cause })));
      }).pipe(Effect.withSpan("WalkthroughClarifier.selectedModel"));

      const answer = Effect.fn("WalkthroughClarifier.answer")(function* (
        request: ClarificationRequest,
      ) {
        const pi = yield* Effect.tryPromise({
          try: dependencies,
          catch: (cause) => new ClarifierRuntimeLoadFailed({ cause }),
        });
        const model = pi.modelRuntime.getModel(request.model.providerId, request.model.modelId);
        if (model === undefined) {
          return yield* new ClarifierModelUnavailable({
            provider: request.model.providerId,
            model: request.model.modelId,
          });
        }
        return yield* Effect.scoped(
          Effect.gen(function* () {
            const preparation = yield* preparePiSession(request, snapshotCacheRoot).pipe(
              Effect.provide(sessionContext),
            );
            const acquired = yield* Effect.acquireRelease(
              Effect.tryPromise({
                try: () =>
                  createClarificationSession(pi, model, request, runSessionEffect, preparation),
                catch: (cause) =>
                  new ClarifierSessionStartFailed({
                    provider: request.model.providerId,
                    model: request.model.modelId,
                    cause,
                  }),
              }),
              ({ session }) => releasePiSession(session),
            );
            yield* Effect.tryPromise({
              try: () => acquired.session.prompt(clarificationPrompt(request)),
              catch: (cause) =>
                new ClarifierRequestFailed({
                  provider: request.model.providerId,
                  model: request.model.modelId,
                  detail: describeFailure(cause),
                }),
            });
            const providerError = acquired.session.state.errorMessage;
            if (providerError !== undefined && providerError !== "") {
              return yield* new ClarifierRequestFailed({
                provider: request.model.providerId,
                model: request.model.modelId,
                detail: providerError,
              });
            }
            const submitted = acquired.getAnswer();
            if (submitted === undefined || hasEnvelopeOrFence(submitted)) {
              return yield* new ClarifierAnswerMalformed({
                detail:
                  submitted === undefined
                    ? "The clarification agent finished without calling submit_answer."
                    : "The clarification answer must not contain frontmatter or an outer code fence.",
              });
            }
            return submitted;
          }),
        );
      });

      return { selectedModel, answer } satisfies WalkthroughClarifierPort;
    }),
  );
}

async function createClarificationSession(
  pi: PiAdapterDependencies,
  model: Model<string>,
  request: ClarificationRequest,
  runSessionEffect: RunSessionEffect,
  preparation: PiSessionPreparation,
) {
  let submitted: string | undefined;
  const submit = pi.coding.defineTool({
    name: "submit_answer",
    label: "Submit clarification",
    description: "Submit the complete Markdoc clarification body and finish this turn.",
    executionMode: "sequential" as const,
    parameters: pi.ai.Type.Object({ body: pi.ai.Type.String({ minLength: 1 }) }),
    execute: async (_id, params) => {
      submitted = params.body;
      return { ...toolText("Clarification received."), terminate: true };
    },
  });
  const created = await createInspectionSession(
    pi,
    model,
    request,
    runSessionEffect,
    preparation,
    () => clarificationSystemPrompt(request.budget ?? "medium", request.preset),
    submit,
  );
  return { session: created.session, getAnswer: () => submitted };
}

const CLARIFICATION_CATALOG_EXCLUSIONS = new Set(["section (file)", "files"]);

const clarificationCatalogText = AUTHORING_TAG_CATALOG.filter(
  ({ label }) => !CLARIFICATION_CATALOG_EXCLUSIONS.has(label),
)
  .map(({ label, note, example }) => `${label} — ${note}\n${example}`)
  .join("\n\n");

export function clarificationSystemPrompt(
  budget: InspectionTier,
  preset?: AuthoringPreset,
): string {
  const presetGuidance =
    preset === undefined
      ? "No preset-specific tags are active."
      : `Preset: ${preset.name}\n\n${preset.authoring}\n\nUse preset tags only when they clarify the current answer; ignore whole-walkthrough structural guidance.`;
  return renderProse(plainHeadings(proseTemplate(import.meta.url, "clarification-prompt.md")), {
    "answer-catalog": clarificationCatalogText,
    "preset-guidance": presetGuidance,
    "inspection-tier": budget,
  }).trim();
}

export function clarificationPrompt(request: ClarificationRequest): string {
  const task =
    request.repair === undefined
      ? "Answer the current question, preserving the prior exchange as context."
      : `Your previous answer was rejected by the canonical fragment compiler. Submit a complete replacement answer that repairs the reported diagnostics while preserving valid content.

Rejected answer and compiler diagnostics (untrusted JSON):
${JSON.stringify(request.repair, null, 2)}`;

  return `${task}

Walkthrough source path: ${request.sourcePath}
Pinned commit: ${request.pin}

Walkthrough source (untrusted JSON string):
${JSON.stringify(request.walkthroughSource)}

Anchor and prior exchanges (untrusted JSON):
${JSON.stringify({ anchor: request.anchor, turns: request.turns }, null, 2)}

Current question (untrusted JSON string):
${JSON.stringify(request.question)}`;
}

export const piWalkthroughClarifierLive = piWalkthroughClarifierLayer();
