/** Effect port and Pi adapter for one stateless clarification answer. */

import type { Model } from "@earendil-works/pi-ai";
import { Cause, Context, Effect, Exit, FileSystem, Layer, Path, Result, Schema } from "effect";
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
}

export interface ClarificationRejection {
  readonly diagnostics: readonly string[];
}

export type ClarificationValidator<Accepted, Rejected extends ClarificationRejection, Error> = (
  body: string,
) => Effect.Effect<Result.Result<Accepted, Rejected>, Error>;

export class ClarifierRuntimeLoadFailed extends Schema.TaggedErrorClass<ClarifierRuntimeLoadFailed>()(
  "ClarifierRuntimeLoadFailed",
  { cause: Schema.Defect() },
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
  readonly answer: <Accepted, Rejected extends ClarificationRejection, ValidationError>(
    request: ClarificationRequest,
    validate: ClarificationValidator<Accepted, Rejected, ValidationError>,
  ) => Effect.Effect<Accepted, ClarifierRunError | Rejected | ValidationError>;
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

type ClarificationSubmission<Accepted, Rejected, ValidationError> =
  | { readonly _tag: "Awaiting" }
  | { readonly _tag: "Accepted"; readonly value: Accepted }
  | { readonly _tag: "Rejected"; readonly error: Rejected }
  | { readonly _tag: "ValidationFailed"; readonly cause: Cause.Cause<ValidationError> };

const MAX_CLARIFICATION_REPAIR_ATTEMPTS = 2;

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

      const answer = Effect.fn("WalkthroughClarifier.answer")(function* <
        Accepted,
        Rejected extends ClarificationRejection,
        ValidationError,
      >(
        request: ClarificationRequest,
        validate: ClarificationValidator<Accepted, Rejected, ValidationError>,
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
                  createClarificationSession(
                    pi,
                    model,
                    request,
                    runSessionEffect,
                    preparation,
                    validate,
                  ),
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
            const submission = acquired.getSubmission();
            switch (submission._tag) {
              case "Accepted":
                return submission.value;
              case "Rejected":
                return yield* Effect.fail(submission.error);
              case "ValidationFailed":
                return yield* Effect.failCause(submission.cause);
              case "Awaiting":
                return yield* new ClarifierAnswerMalformed({
                  detail: "The clarification agent finished without a valid submit_answer call.",
                });
            }
          }),
        );
      });

      return { answer } satisfies WalkthroughClarifierPort;
    }),
  );
}

async function createClarificationSession<
  Accepted,
  Rejected extends ClarificationRejection,
  ValidationError,
>(
  pi: PiAdapterDependencies,
  model: Model<string>,
  request: ClarificationRequest,
  runSessionEffect: RunSessionEffect,
  preparation: PiSessionPreparation,
  validate: ClarificationValidator<Accepted, Rejected, ValidationError>,
) {
  let submission: ClarificationSubmission<Accepted, Rejected, ValidationError> = {
    _tag: "Awaiting",
  };
  let repairs = 0;
  let previousDiagnostics: readonly string[] | undefined;
  const submit = pi.coding.defineTool({
    name: "submit_answer",
    label: "Submit clarification",
    description:
      "Validate and submit the complete Markdoc clarification body. Invalid bodies return diagnostics for correction; a valid body finishes the turn.",
    executionMode: "sequential" as const,
    parameters: pi.ai.Type.Object({ body: pi.ai.Type.String({ minLength: 1 }) }),
    execute: async (_id, params) => {
      const checked = await Effect.runPromiseExit(validate(params.body));
      if (Exit.isFailure(checked)) {
        submission = { _tag: "ValidationFailed", cause: checked.cause };
        return { ...toolText("Clarification validation could not complete."), terminate: true };
      }
      if (Result.isSuccess(checked.value)) {
        submission = { _tag: "Accepted", value: checked.value.success };
        return { ...toolText("Clarification checked and accepted."), terminate: true };
      }

      const rejected = checked.value.failure;
      if (
        repairs >= MAX_CLARIFICATION_REPAIR_ATTEMPTS ||
        (previousDiagnostics !== undefined &&
          sameDiagnostics(previousDiagnostics, rejected.diagnostics))
      ) {
        submission = { _tag: "Rejected", error: rejected };
        return {
          ...toolText("Clarification remained invalid after bounded repair."),
          terminate: true,
        };
      }

      repairs += 1;
      previousDiagnostics = rejected.diagnostics;
      return toolText(repairFeedback(rejected.diagnostics));
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
  return { session: created.session, getSubmission: () => submission };
}

function sameDiagnostics(previous: readonly string[], next: readonly string[]): boolean {
  const normalized = (diagnostics: readonly string[]) => [...new Set(diagnostics)].toSorted();
  const before = normalized(previous);
  const after = normalized(next);
  return before.length === after.length && before.every((value, index) => value === after[index]);
}

function repairFeedback(diagnostics: readonly string[]): string {
  return `The answer did not pass the canonical clarification check. Repair only what these diagnostics prove is invalid, then call submit_answer again with the complete replacement.

Validation diagnostics (untrusted JSON):
${JSON.stringify(diagnostics, null, 2)}`;
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
  return `Answer the current question, preserving the prior exchange as context.

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
