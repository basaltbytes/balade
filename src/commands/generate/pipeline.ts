/** Generate → write → check → repair, with the invalid draft kept for manual recovery. */

import { Effect, FileSystem, Path, Result, Schema } from "effect";
import { stringify as stringifyYaml } from "yaml";
import { formatText } from "../../terminal.js";
import { runCheck } from "../../walkthrough/checker.js";
import { discoveryErrorMessage } from "../../walkthrough/discovery.js";
import { CheckReport as CheckReportSchema } from "../../contract/schema.js";
import type { Lang, CheckReport } from "../../contract/types.js";
import type { PullHeadError, PullSnapshot } from "../../git/pr.js";
import { escapesRoot } from "../../contract/paths.js";
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

const MAX_REPAIR_ATTEMPTS = 2;

export class OutputOutsideRepository extends Schema.TaggedErrorClass<OutputOutsideRepository>()(
  "OutputOutsideRepository",
  { directory: Schema.String, root: Schema.String },
) {}

export class OutputAlreadyExists extends Schema.TaggedErrorClass<OutputAlreadyExists>()(
  "OutputAlreadyExists",
  { file: Schema.String },
) {}

export class DraftWriteFailed extends Schema.TaggedErrorClass<DraftWriteFailed>()(
  "DraftWriteFailed",
  { file: Schema.String, cause: Schema.Defect() },
) {}

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
  | OutputAlreadyExists
  | DraftWriteFailed
  | RepairFailed;

export const runGeneration = Effect.fn("runGeneration")((options: RunGenerationOptions) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const author = yield* WalkthroughAuthor;
    const outputDirectory = yield* validateOutputDirectory(
      fs,
      path,
      options.source.root,
      options.directory,
    );

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

    const file = path.join(
      outputDirectory,
      `pr-${options.source.pull.number}-${slugifyTitle(initial.draft.title)}.md`,
    );
    yield* prepareOutputDirectory(
      fs,
      path,
      options.source.root,
      outputDirectory,
      options.directory,
    );
    yield* fs
      .writeFileString(
        file,
        renderDraft(options.source, initial.draft, options.preset, options.lang),
        { flag: "wx" },
      )
      .pipe(
        Effect.mapError((cause) =>
          cause.reason._tag === "AlreadyExists"
            ? new OutputAlreadyExists({ file })
            : new DraftWriteFailed({ file, cause }),
        ),
      );

    let turn = initial;
    let repairs = 0;
    let report = yield* checkGeneratedDraft(options.source.root, file);
    while (!report.ok && repairs < MAX_REPAIR_ATTEMPTS) {
      repairs++;
      turn = yield* session
        .repair(formatText({ reports: [report] }))
        .pipe(Effect.mapError((cause) => new RepairFailed({ file, report, cause })));
      yield* replaceDraft(
        fs,
        path,
        file,
        renderDraft(options.source, turn.draft, options.preset, options.lang),
      ).pipe(Effect.mapError((cause) => new RepairFailed({ file, report, cause })));
      report = yield* checkGeneratedDraft(options.source.root, file);
    }

    const summary: GenerationSummary = { file, report, usage: turn.usage, repairs };
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

const validateOutputDirectory = Effect.fn("validateOutputDirectory")(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
  directory: string,
) {
  if (path.isAbsolute(directory)) {
    return yield* new OutputOutsideRepository({ directory, root });
  }
  const output = path.resolve(root, directory);
  const relative = path.relative(root, output);
  if (escapesRoot(path, relative) || isGitMetadata(path, relative)) {
    return yield* new OutputOutsideRepository({ directory, root });
  }
  const canonicalRoot = yield* fs
    .realPath(root)
    .pipe(Effect.mapError((cause) => new DraftWriteFailed({ file: output, cause })));
  const ancestor = yield* nearestExistingPath(fs, path, output);
  if (escapesRoot(path, path.relative(canonicalRoot, ancestor))) {
    return yield* new OutputOutsideRepository({ directory, root });
  }
  return output;
});

const nearestExistingPath = Effect.fn("nearestExistingPath")(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  requested: string,
) {
  let current = requested;
  while (true) {
    const resolved = yield* Effect.result(fs.realPath(current));
    if (Result.isSuccess(resolved)) return resolved.success;
    if (resolved.failure.reason._tag !== "NotFound") {
      return yield* new DraftWriteFailed({ file: requested, cause: resolved.failure });
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return yield* new DraftWriteFailed({ file: requested, cause: resolved.failure });
    }
    current = parent;
  }
});

const prepareOutputDirectory = Effect.fn("prepareOutputDirectory")(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
  output: string,
  requested: string,
) {
  yield* fs
    .makeDirectory(output, { recursive: true })
    .pipe(Effect.mapError((cause) => new DraftWriteFailed({ file: output, cause })));
  const [canonicalRoot, canonicalOutput] = yield* Effect.all([
    fs.realPath(root),
    fs.realPath(output),
  ]).pipe(Effect.mapError((cause) => new DraftWriteFailed({ file: output, cause })));
  if (escapesRoot(path, path.relative(canonicalRoot, canonicalOutput))) {
    return yield* new OutputOutsideRepository({ directory: requested, root });
  }
});

const replaceDraft = Effect.fn("replaceDraft")(
  (fs: FileSystem.FileSystem, path: Path.Path, file: string, contents: string) =>
    Effect.gen(function* () {
      const temporary = yield* fs.makeTempFileScoped({
        directory: path.dirname(file),
        prefix: ".balade-repair-",
      });
      yield* fs.writeFileString(temporary, contents);
      yield* fs.rename(temporary, file);
    }).pipe(
      Effect.scoped,
      Effect.mapError((cause) => new DraftWriteFailed({ file, cause })),
    ),
);

const isGitMetadata = (path: Path.Path, relative: string): boolean =>
  relative.toLowerCase() === ".git" || relative.toLowerCase().startsWith(`.git${path.sep}`);

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

export function slugifyTitle(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 64)
    .replace(/-$/u, "");
  return slug === "" ? "walkthrough" : slug;
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
    case "OutputAlreadyExists":
      return `${error.file} already exists; move it or choose another output directory.`;
    case "DraftWriteFailed":
      return `Could not write generated walkthrough ${error.file}.`;
    case "RepairFailed":
      return `balade retained ${error.file}, but the repair turn failed: ${repairFailureMessage(error.cause)}`;
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
