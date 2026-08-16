/** Generate → write → check → repair, with the invalid draft kept for manual recovery. */

import { Effect, Result, Schema } from "effect";
import { stringify as stringifyYaml } from "yaml";
import { formatText } from "../../terminal.js";
import { checkOne } from "../../walkthrough/checker.js";
import { discoveryErrorMessage } from "../../walkthrough/discovery.js";
import { CheckReport as CheckReportSchema } from "../../contract/schema.js";
import type { Lang, CheckReport } from "../../contract/types.js";
import type { PullHeadError, PullSnapshot } from "../../git/pr.js";
import { repairInvalid } from "../../repair.js";
import {
  DraftMalformed,
  ProviderRequestFailed,
  WalkthroughAuthor,
  type AuthorDraft,
  type AuthorModel,
  type AuthorProgress,
  type AuthorProgressMode,
  type AuthorStartupError,
  type AuthorUsage,
  type AuthoringPreset,
  type HeadInstructionPolicy,
} from "../../pi/author.js";
import {
  AUTHORING_META_KEY,
  AUTHORING_PACKAGE_VERSION,
  type InspectionTier,
} from "../../authoring/package.js";
import {
  DraftRetentionFailed,
  DraftWriteFailed,
  type ExistingWalkthrough,
  OutputAccessFailed,
  OutputOutsideRepository,
  replaceGeneratedDraft,
  type SupersededWalkthrough,
  validateGenerationOutput,
  writeGenerationDraft,
} from "./output.js";

const MAX_REPAIR_ATTEMPTS = 2;

const RepairCause = Schema.Union([ProviderRequestFailed, DraftMalformed, DraftWriteFailed]);
type RepairCause = typeof RepairCause.Type;

export class RepairFailed extends Schema.TaggedErrorClass<RepairFailed>()("RepairFailed", {
  file: Schema.String,
  report: CheckReportSchema,
  cause: RepairCause,
}) {}

export interface RunGenerationOptions {
  readonly source: PullSnapshot;
  readonly model: AuthorModel;
  readonly directory: string;
  /** Same-identity files the command boundary resolved for replacement pre-flight. */
  readonly supersede: readonly ExistingWalkthrough[];
  /** Named by `--preset`; teaches the author its tags and stamps the frontmatter. */
  readonly preset?: AuthoringPreset;
  /** Named by `--lang`; the draft is authored in it and `meta.lang` is stamped. */
  readonly lang?: Lang;
  /** Named by `--prompt`; operator-typed steering forwarded to the authoring request. */
  readonly guidance?: string;
  /** Named by `--budget`; sizes the inspection budget. */
  readonly budget?: InspectionTier;
  readonly headInstructionPolicy: HeadInstructionPolicy;
  readonly progress: (event: AuthorProgress) => void;
  readonly progressMode: AuthorProgressMode;
}

interface GenerationSummary {
  readonly file: string;
  readonly report: CheckReport;
  readonly usage: AuthorUsage;
  readonly repairs: number;
  readonly siblings: readonly string[];
  readonly superseded: readonly SupersededWalkthrough[];
}

export interface Generated extends GenerationSummary {
  readonly _tag: "Generated";
}

export interface GeneratedWithDiagnostics extends GenerationSummary {
  readonly _tag: "GeneratedWithDiagnostics";
}

export type GenerationResult = Generated | GeneratedWithDiagnostics;

export type GenerateError =
  | PullHeadError
  | AuthorStartupError
  | ProviderRequestFailed
  | DraftMalformed
  | OutputOutsideRepository
  | OutputAccessFailed
  | DraftWriteFailed
  | DraftRetentionFailed
  | RepairFailed;

export const runGeneration = Effect.fn("runGeneration")((options: RunGenerationOptions) =>
  Effect.gen(function* () {
    const author = yield* WalkthroughAuthor;
    yield* validateGenerationOutput({
      root: options.source.root,
      directory: options.directory,
      pullNumber: options.source.pull.number,
    });
    const requestFacets: AuthoringRequestFacets = {};
    if (options.preset !== undefined) requestFacets.preset = options.preset;
    if (options.lang !== undefined) requestFacets.lang = options.lang;
    if (options.guidance !== undefined) requestFacets.guidance = options.guidance;
    if (options.budget !== undefined) requestFacets.budget = options.budget;
    const session = yield* author.start({
      root: options.source.root,
      pin: options.source.pin,
      base: options.source.base,
      pull: options.source.pull,
      claims: options.source.claims,
      files: options.source.files,
      model: options.model,
      ...requestFacets,
      headInstructionPolicy: options.headInstructionPolicy,
      progressMode: options.progressMode,
      progress: options.progress,
    });
    const initial = session.initial;

    const output = yield* writeGenerationDraft({
      root: options.source.root,
      directory: options.directory,
      pullNumber: options.source.pull.number,
      title: initial.draft.title,
      contents: renderDraft(options.source, initial.draft, options.preset, options.lang),
      supersede: options.supersede,
    });
    const file = output.file;

    const repaired = yield* repairInvalid({
      initial,
      evaluate: () =>
        checkGeneratedDraft(options.source, file).pipe(
          Effect.map((report) => (report.ok ? Result.succeed(report) : Result.fail(report))),
        ),
      repair: (_turn, report) =>
        session.repair(formatText({ reports: [report] })).pipe(
          Effect.mapError((cause) => new RepairFailed({ file, report, cause })),
          Effect.tap((turn) =>
            replaceGeneratedDraft(
              file,
              renderDraft(options.source, turn.draft, options.preset, options.lang),
            ).pipe(Effect.mapError((cause) => new RepairFailed({ file, report, cause }))),
          ),
        ),
      maxAttempts: MAX_REPAIR_ATTEMPTS,
      stopAfter: sameDiagnosticLocations,
    });
    const { candidate: turn, repairs } = repaired;
    const report = Result.merge(repaired.outcome);

    const summary: GenerationSummary = {
      file,
      report,
      usage: turn.usage,
      repairs,
      siblings: output.siblings,
      superseded: output.superseded,
    };
    return report.ok
      ? ({ _tag: "Generated", ...summary } satisfies Generated)
      : ({ _tag: "GeneratedWithDiagnostics", ...summary } satisfies GeneratedWithDiagnostics);
  }).pipe(Effect.scoped),
);

function sameDiagnosticLocations(previous: CheckReport, next: CheckReport): boolean {
  const locations = (report: CheckReport) =>
    report.diagnostics
      .map(({ code, line }) => ({ code, line }))
      .toSorted(
        (left, right) =>
          left.code.localeCompare(right.code) || (left.line ?? -1) - (right.line ?? -1),
      );
  const before = locations(previous);
  const after = locations(next);
  return (
    before.length === after.length &&
    before.every(
      (value, index) => value.code === after[index]?.code && value.line === after[index]?.line,
    )
  );
}

const checkGeneratedDraft = Effect.fn("checkGeneratedDraft")((source: PullSnapshot, file: string) =>
  checkOne({
    cwd: source.root,
    path: file,
    resolution: { _tag: "PullRange", base: source.base, head: source.head },
    useGh: false,
  }),
);

type AuthoringRequestFacets = {
  preset?: AuthoringPreset;
  lang?: Lang;
  guidance?: string;
  budget?: InspectionTier;
};
type MetaLangFacet = { lang?: Lang };
type StampedPresetFacet = { preset?: string };

export function renderDraft(
  source: PullSnapshot,
  draft: AuthorDraft,
  preset?: AuthoringPreset,
  lang?: Lang,
): string {
  /* An explicit `--preset` or `--lang` is the authority: a stamped preset is
     what makes its tags active at check time, and a stamped lang is what sets
     the chrome language; a model-supplied value stands only without the flag. */
  const active = preset?.name ?? draft.preset;
  const langFacet: MetaLangFacet = {};
  if (lang !== undefined) langFacet.lang = lang;
  const presetFacet: StampedPresetFacet = {};
  if (active !== undefined) presetFacet.preset = active;
  const frontmatter = stringifyYaml({
    walkthrough: 1,
    title: draft.title,
    pr: source.pull.number,
    commit: source.pin,
    meta: {
      ...draft.meta,
      ...langFacet,
      [AUTHORING_META_KEY]: AUTHORING_PACKAGE_VERSION,
    },
    ...presetFacet,
  }).trimEnd();
  return `---\n${frontmatter}\n---\n\n${draft.body.trim()}\n`;
}

export function generateErrorMessage(error: GenerateError): string {
  switch (error._tag) {
    case "WrongRepository":
    case "PullFetchFailed":
      return error.note;
    case "NotARepository":
    case "CommandFailed":
      return discoveryErrorMessage(error);
    case "AuthorRuntimeLoadFailed":
      return "Could not load the authoring runtime. Check the balade installation and authoring-state permissions, then retry.";
    case "AuthorModelUnavailable":
      return `${error.provider}/${error.model} is no longer available. Select an available model and try again.`;
    case "SnapshotOpenFailed":
      return `Could not prepare pinned source ${error.pin} from ${error.repositoryRoot}. Check repository and snapshot-cache permissions, then retry.`;
    case "SnapshotReadFailed":
      return `Could not read ${error.path} from the pinned source. Verify the repository state and retry.`;
    case "SnapshotPathRejected":
      return `Refused pinned source path ${error.path}: ${error.reason}`;
    case "AuthorSearchConfigurationFailed":
      return `Could not configure pinned-source search at ${error.file}. Check snapshot-cache permissions, then retry.`;
    case "AuthorSessionStartFailed":
      return `Could not start ${error.provider}/${error.model}. Check provider setup and authentication, then retry.`;
    case "ProviderRequestFailed":
      return `${error.provider}/${error.model} stopped while drafting: ${error.detail}`;
    case "DraftMalformed":
      return `The model did not submit a usable walkthrough: ${error.detail}`;
    case "OutputOutsideRepository":
      return `Output directory ${error.directory} is not a writable source directory inside ${error.root}.`;
    case "OutputAccessFailed":
      return `Could not ${outputAccessAction(error.operation)} at ${error.path} (${error.reason}).`;
    case "DraftWriteFailed":
      return error.operation === "remove"
        ? `Could not remove superseded walkthrough ${error.file} (${error.reason}).`
        : `Could not replace generated walkthrough ${error.file} (${error.reason}).`;
    case "DraftRetentionFailed":
      return `Superseding ${error.file} stopped: its uncommitted content could not be retained beside it (${error.reason}).`;
    case "RepairFailed":
      return `balade retained ${error.file}, but the repair turn failed: ${repairFailureMessage(error.cause)}`;
  }
}

function outputAccessAction(operation: OutputAccessFailed["operation"]): string {
  switch (operation) {
    case "resolve":
      return "resolve the output path";
    case "list":
      return "list the output directory";
    case "prepare":
      return "prepare the output directory";
  }
}

function repairFailureMessage(cause: RepairCause): string {
  switch (cause._tag) {
    case "ProviderRequestFailed":
      return "the provider stopped before submitting a replacement";
    case "DraftMalformed":
      return "the provider did not submit a valid replacement";
    case "DraftWriteFailed":
      return "the replacement could not be saved atomically";
  }
}
