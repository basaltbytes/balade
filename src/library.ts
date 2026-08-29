/**
 * The programmatic entry: `generate`, `check` and `build` as promises, with no
 * terminal in the loop. A script or a CI job imports this instead of spawning
 * the executable and parsing its prose. The paid pipeline is the one the CLI
 * runs; what differs is the pre-flight — no model picker, no replace prompt —
 * and what a failure looks like: the tagged error itself, rejected, carrying
 * the sentence the CLI would have printed.
 */

import { NodeServices } from "@effect/platform-node";
import { Effect, Layer, Option, Schema } from "effect";
import {
  agentModelErrorMessage,
  resolveAgentModel,
  type AgentModelResolutionError,
  type ExplicitModel,
} from "./agent/model.js";
import type { InspectionTier } from "./authoring/package.js";
import {
  buildErrorMessage,
  runBuild,
  type BuildOptions as BuildPipelineOptions,
  type BuildOutcome,
} from "./commands/build/pipeline.js";
import {
  DEFAULT_WALKTHROUGH_DIRECTORY,
  inspectExistingWalkthroughs,
  planSupersession,
} from "./commands/generate/output.js";
import {
  generateErrorMessage as generationErrorMessage,
  runGeneration,
  type GenerateError as GenerationError,
  type GenerationResult,
} from "./commands/generate/pipeline.js";
import type { GenerationProgress } from "./commands/generate/progress.js";
import { langOfMeta } from "./contract/schema.js";
import type { CheckReport, Lang } from "./contract/types.js";
import { contextResolverLive } from "./git/git.js";
import { parsePrTarget, resolvePullHead } from "./git/pr.js";
import {
  WalkthroughAuthor,
  type AuthoringPreset,
  type HeadInstructionPolicy,
} from "./pi/author.js";
import { piWalkthroughAuthorLive } from "./pi/client.js";
import { getPreset, presetNames } from "./preset/registry.js";
import { CommandExecutor } from "./shell.js";
import { checkOne, type CheckFileOptions } from "./walkthrough/checker.js";

export type {
  AgentModelResolutionError,
  AgentModelUnresolved,
  ExplicitModel,
  NoProviderAuthenticated,
} from "./agent/model.js";
export type { InspectionTier } from "./authoring/package.js";
export type {
  BuildError,
  BuildFailed,
  BuildNotRun,
  BuildOutcome,
  Built,
} from "./commands/build/pipeline.js";
export type { SupersededWalkthrough } from "./commands/generate/output.js";
export type {
  Generated,
  GeneratedWithDiagnostics,
  GenerationResult,
} from "./commands/generate/pipeline.js";
export type {
  GenerationProgress,
  GenerationStatus,
  GenerationTiming,
  GenerationTimingSegment,
} from "./commands/generate/progress.js";
export type { CheckDiagnostic, CheckReport, Lang, RangeEcho } from "./contract/types.js";
export type { PullNotice } from "./git/intent.js";
export type { AuthorModel, AuthorUsage, HeadInstructionPolicy } from "./pi/author.js";

/**
 * Host services and the process adapter, then the adapters that need them:
 * the executable's stack minus the terminal, the browser and agent presence.
 * Built once per call, so a finished call holds no handle open.
 */
export const liveLayer = Layer.mergeAll(piWalkthroughAuthorLive, contextResolverLive).pipe(
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, CommandExecutor.layer)),
);

/** `pullRequest` names no GitHub pull request. */
export class PullTargetInvalid extends Schema.TaggedErrorClass<PullTargetInvalid>()(
  "PullTargetInvalid",
  { target: Schema.String },
) {}

export class PresetUnknown extends Schema.TaggedErrorClass<PresetUnknown>()("PresetUnknown", {
  preset: Schema.String,
  available: Schema.Array(Schema.String),
}) {}

/**
 * Same-identity walkthroughs the CLI would ask about: stamped at the current
 * head, or without a readable stamp. `force: true` replaces them.
 */
export class ExistingWalkthroughUndecided extends Schema.TaggedErrorClass<ExistingWalkthroughUndecided>()(
  "ExistingWalkthroughUndecided",
  { files: Schema.Array(Schema.String) },
) {}

export interface GenerateOptions {
  /** A path inside the clone; the repository root is resolved from it. Defaults to the working directory. */
  readonly repository?: string;
  /** Bare number, `#number`, or GitHub pull request URL. A URL also pins the `owner/name` the clone must match. */
  readonly pullRequest: number | string;
  /** The provider and model to author with. Omitted, the preference saved by `balade agent setup` applies. */
  readonly model?: ExplicitModel;
  /** Activates a preset's tags for this walkthrough and stamps it. */
  readonly preset?: string;
  /** The walkthrough is authored and stamped in this language. */
  readonly lang?: Lang;
  /** Reviewer guidance appended to the base prompt for this run. */
  readonly guidance?: string;
  /** Inspection budget; `medium` scales with the pull request. */
  readonly budget?: InspectionTier;
  /** Repository-relative output directory. Defaults to `.agents/walkthroughs`. */
  readonly directory?: string;
  /** Replace an existing same-head walkthrough instead of failing with `ExistingWalkthroughUndecided`. */
  readonly force?: boolean;
  /** Whether `AGENTS.md` or `CLAUDE.md` files changed by the pull request apply. Defaults to `omit-changed`. */
  readonly headInstructions?: HeadInstructionPolicy;
  /** Receives every progress event the CLI renders, in order. */
  readonly onProgress?: (event: GenerationProgress) => void;
}

export type GenerateError =
  | PullTargetInvalid
  | PresetUnknown
  | ExistingWalkthroughUndecided
  | AgentModelResolutionError
  | GenerationError;

type GenerationFacets = {
  preset?: AuthoringPreset;
  lang?: Lang;
  guidance?: string;
  budget?: InspectionTier;
};

const noProgress = (): void => {};

/**
 * The pre-flight the `generate` command runs, minus its two questions, then
 * the pipeline it runs. Local checks fail first — the target, the preset, the
 * model — before the pull request head is fetched.
 */
export const generateWalkthrough = Effect.fn("generateWalkthrough")(
  function* (options: GenerateOptions) {
    const reference = String(options.pullRequest);
    const target = parsePrTarget(reference);
    if (target === null) return yield* new PullTargetInvalid({ target: reference });
    const preset = options.preset === undefined ? undefined : getPreset(options.preset);
    if (options.preset !== undefined && preset === undefined) {
      return yield* new PresetUnknown({ preset: options.preset, available: presetNames() });
    }
    const author = yield* WalkthroughAuthor;
    const model = yield* resolveAgentModel(author, Option.fromNullishOr(options.model));

    const source = yield* resolvePullHead({ cwd: options.repository ?? process.cwd(), target });
    const directory = options.directory ?? DEFAULT_WALKTHROUGH_DIRECTORY;
    const existing = yield* inspectExistingWalkthroughs({
      root: source.root,
      directory,
      pullNumber: source.pull.number,
    });
    const plan = planSupersession(existing, source.pin, langOfMeta(options.lang));
    if (plan.undecided.length > 0 && options.force !== true) {
      return yield* new ExistingWalkthroughUndecided({
        files: plan.undecided.map((candidate) => candidate.relativeFile),
      });
    }

    const facets: GenerationFacets = {};
    if (preset !== undefined) facets.preset = { name: preset.name, authoring: preset.authoring };
    if (options.lang !== undefined) facets.lang = options.lang;
    if (options.guidance !== undefined) facets.guidance = options.guidance;
    if (options.budget !== undefined) facets.budget = options.budget;
    return yield* runGeneration({
      source,
      model,
      directory,
      supersede: [...plan.refreshing, ...plan.undecided],
      headInstructionPolicy: options.headInstructions ?? "omit-changed",
      progress: options.onProgress ?? noProgress,
      ...facets,
    });
  },
  Effect.mapError((error) => withMessage(error, generateErrorMessage(error))),
);

export function generate(options: GenerateOptions): Promise<GenerationResult> {
  return Effect.runPromise(generateWalkthrough(options).pipe(Effect.provide(liveLayer)));
}

export interface CheckOptions {
  /** What a relative `file` is resolved against. Defaults to the working directory. */
  readonly cwd?: string;
  /** `false` skips gh entirely — CI without auth. */
  readonly useGh?: boolean;
}

/** The report `balade check --json` prints for one file. Diagnostics are values: this never fails. */
export const checkWalkthrough = Effect.fn("checkWalkthrough")(function* (
  file: string,
  options: CheckOptions = {},
) {
  const fileOptions: CheckFileOptions = { cwd: options.cwd ?? process.cwd(), path: file };
  if (options.useGh !== undefined) fileOptions.useGh = options.useGh;
  return yield* checkOne(fileOptions);
});

export function check(file: string, options?: CheckOptions): Promise<CheckReport> {
  return Effect.runPromise(checkWalkthrough(file, options).pipe(Effect.provide(liveLayer)));
}

export interface BuildOptions {
  /** What a relative `file` or `out` is resolved against. Defaults to the working directory. */
  readonly cwd?: string;
  /** Output path, absolute or relative to `cwd`. Defaults to `<walkthrough>.html` beside the file. */
  readonly out?: string;
  /** Chrome language override; the walkthrough's own `meta.lang` applies otherwise. */
  readonly lang?: Lang;
  /** `false` skips gh entirely — CI without auth. */
  readonly useGh?: boolean;
  /** Where the export bundle is read from; defaults to the one shipped with balade. */
  readonly bundleDir?: string;
}

/** `balade build` for one file: the outcome the command prints, as a value. */
export const buildWalkthrough = Effect.fn("buildWalkthrough")(
  function* (file: string, options: BuildOptions = {}) {
    const buildOptions: BuildPipelineOptions = {
      cwd: options.cwd ?? process.cwd(),
      paths: [file],
    };
    if (options.out !== undefined) buildOptions.out = options.out;
    if (options.lang !== undefined) buildOptions.lang = options.lang;
    if (options.useGh !== undefined) buildOptions.useGh = options.useGh;
    if (options.bundleDir !== undefined) buildOptions.bundleDir = options.bundleDir;
    return yield* runBuild(buildOptions);
  },
  Effect.mapError((error) => withMessage(error, buildErrorMessage(error))),
);

export function build(file: string, options?: BuildOptions): Promise<BuildOutcome> {
  return Effect.runPromise(buildWalkthrough(file, options).pipe(Effect.provide(liveLayer)));
}

/**
 * The CLI prints one sentence per failure at its boundary; a rejected promise
 * is this entry's boundary, and `message` is what every consumer reads there.
 * The instance stays the tagged error — `_tag`, fields, `instanceof` — so a
 * caller can still match on it.
 */
function withMessage<E extends Error>(error: E, message: string): E {
  Object.defineProperty(error, "message", { value: message, configurable: true, writable: true });
  return error;
}

function generateErrorMessage(error: GenerateError): string {
  switch (error._tag) {
    case "PullTargetInvalid":
      return `Name one GitHub pull request — a number, '#number' or its URL — not ${JSON.stringify(error.target)}.`;
    case "PresetUnknown":
      return `Unknown preset \`${error.preset}\`. Available: ${error.available.join(", ")}.`;
    case "ExistingWalkthroughUndecided":
      return (
        `${error.files.join(", ")} already ${error.files.length === 1 ? "exists" : "exist"} for this pull request ` +
        "at the current head or without a readable stamp. Pass `force: true` to replace, or `directory` to write elsewhere."
      );
    case "AuthorDiscoveryFailed":
    case "NoProviderAuthenticated":
      return agentModelErrorMessage(error);
    case "AuthorPreferenceReadFailed":
      return "The saved agent model could not be read. Pass `model` explicitly, or run `balade agent setup` to save one again.";
    case "AgentModelUnresolved":
      return (
        `No authenticated agent model matches ${error.requested}. Available: ` +
        `${error.available.map((model) => `${model.providerId}/${model.modelId}`).join(", ")}.`
      );
    default:
      return generationErrorMessage(error);
  }
}
