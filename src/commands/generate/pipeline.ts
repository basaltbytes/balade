/** Generate → write → check → repair, with the invalid draft kept for manual recovery. */

import { Effect, Schema } from "effect";
import { stringify as stringifyYaml } from "yaml";
import { formatText } from "../../terminal.js";
import { runCheck } from "../../walkthrough/checker.js";
import { discoveryErrorMessage } from "../../walkthrough/discovery.js";
import { CheckReport as CheckReportSchema } from "../../contract/schema.js";
import type { Lang, CheckReport } from "../../contract/types.js";
import type { PullHeadError, PullSnapshot } from "../../git/pr.js";
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
import { AUTHORING_META_KEY, AUTHORING_PACKAGE_VERSION } from "../../authoring/package.js";
import {
  DraftRetentionFailed,
  DraftWriteFailed,
  findGeneratedWalkthroughs,
  type CollisionPolicy,
  OutputAccessFailed,
  OutputAlreadyExists,
  OutputOutsideRepository,
  replaceGeneratedDraft,
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
  /** `--force` becomes this explicit policy at the command boundary. */
  readonly collisionPolicy: CollisionPolicy;
  /** Runs before the paid authoring turn when same-PR outputs already exist. */
  readonly onExistingWalkthroughs: (files: readonly string[]) => void;
  /** Named by `--preset`; teaches the author its tags and stamps the frontmatter. */
  readonly preset?: AuthoringPreset;
  /** Named by `--lang`; the draft is authored in it and `meta.lang` is stamped. */
  readonly lang?: Lang;
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
  | OutputAlreadyExists
  | DraftWriteFailed
  | DraftRetentionFailed
  | RepairFailed;

export const runGeneration = Effect.fn("runGeneration")((options: RunGenerationOptions) =>
  Effect.gen(function* () {
    const author = yield* WalkthroughAuthor;
    const existing = yield* findGeneratedWalkthroughs({
      root: options.source.root,
      directory: options.directory,
      pullNumber: options.source.pull.number,
    });
    if (existing.length > 0) options.onExistingWalkthroughs(existing);

    const session = yield* author.start({
      root: options.source.root,
      pin: options.source.pin,
      base: options.source.base,
      pull: options.source.pull,
      claims: options.source.claims,
      files: options.source.files,
      model: options.model,
      ...(options.preset === undefined ? {} : { preset: options.preset }),
      ...(options.lang === undefined ? {} : { lang: options.lang }),
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
      currentHead: options.source.pin,
      collisionPolicy: options.collisionPolicy,
    });
    const file = output.file;

    let turn = initial;
    let repairs = 0;
    let report = yield* checkGeneratedDraft(options.source.root, file);
    while (!report.ok && repairs < MAX_REPAIR_ATTEMPTS) {
      repairs++;
      turn = yield* session
        .repair(formatText({ reports: [report] }))
        .pipe(Effect.mapError((cause) => new RepairFailed({ file, report, cause })));
      yield* replaceGeneratedDraft(
        file,
        renderDraft(options.source, turn.draft, options.preset, options.lang),
      ).pipe(Effect.mapError((cause) => new RepairFailed({ file, report, cause })));
      report = yield* checkGeneratedDraft(options.source.root, file);
    }

    const summary: GenerationSummary = {
      file,
      report,
      usage: turn.usage,
      repairs,
      siblings: output.siblings,
    };
    return report.ok
      ? ({ _tag: "Generated", ...summary } satisfies Generated)
      : ({ _tag: "GeneratedWithDiagnostics", ...summary } satisfies GeneratedWithDiagnostics);
  }).pipe(Effect.scoped),
);

const checkGeneratedDraft = Effect.fn("checkGeneratedDraft")(function* (
  root: string,
  file: string,
) {
  const outcome = yield* runCheck({
    cwd: root,
    paths: [file],
    useGh: false,
  });
  const report = outcome.reports[0];
  return report === undefined
    ? yield* Effect.die(new Error("balade check returned no report for an explicit file."))
    : report;
});

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
  const frontmatter = stringifyYaml({
    walkthrough: 1,
    title: draft.title,
    pr: source.pull.number,
    commit: source.pin,
    meta: {
      ...draft.meta,
      ...(lang === undefined ? {} : { lang }),
      [AUTHORING_META_KEY]: AUTHORING_PACKAGE_VERSION,
    },
    ...(active === undefined ? {} : { preset: active }),
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
    case "OutputAlreadyExists":
      return outputCollisionMessage(error);
    case "DraftWriteFailed":
      return `Could not ${error.operation} generated walkthrough ${error.file} (${error.reason}).`;
    case "DraftRetentionFailed":
      return `A completed draft collided with ${error.file}, but balade could not retain it beside that file (${error.reason}).`;
    case "RepairFailed":
      return `balade retained ${error.file}, but the repair turn failed: ${repairFailureMessage(error.cause)}`;
  }
}

function outputCollisionMessage(error: OutputAlreadyExists): string {
  const retained = `The completed draft was retained at ${error.retainedFile}.`;
  switch (error.existing._tag) {
    case "ExistingSameHead":
      return `${error.file} already exists for this same head. ${retained} Re-run with --force to replace it, or use --dir to redirect the output.`;
    case "ExistingDifferentHead":
      return `${error.file} is stamped ${shortCommit(error.existing.pin)}, but the pull-request head is now ${shortCommit(error.currentHead)}. ${retained} Re-run with --force to refresh it, or use --dir to redirect the output.`;
    case "ExistingStampInvalid":
      return `${error.file} already exists without a readable walkthrough stamp. ${retained} Re-run with --force to replace it, or use --dir to redirect the output.`;
    case "ExistingStampUnreadable":
      return `${error.file} already exists, but its walkthrough stamp could not be read (${error.existing.reason}). ${retained} Re-run with --force to replace it, or use --dir to redirect the output.`;
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

const shortCommit = (commit: string): string => commit.slice(0, 7);

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
