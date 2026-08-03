/** Generate → write → check → repair, with the invalid draft kept for manual recovery. */

import { Effect, FileSystem, Path, Result, Schema } from "effect";
import { stringify as stringifyYaml } from "yaml";
import { formatText } from "../check/report.js";
import { runCheck } from "../check/run.js";
import { discoveryErrorMessage } from "../check/discover.js";
import { CheckReport as CheckReportSchema } from "../payload/schema.js";
import type { CheckReport } from "../payload/types.js";
import type { PrTarget } from "../pr/target.js";
import { resolvePullHead, type PullHeadError, type PullNotice } from "../resolve/git.js";
import {
  AuthorSessionStartFailed,
  DraftMalformed,
  ProviderRequestFailed,
  WalkthroughAuthor,
  type AuthorDraft,
  type AuthorModel,
  type AuthorProgress,
  type AuthorUsage,
} from "./author.js";

const MAX_REPAIR_ATTEMPTS = 2;

export interface PreparedGeneration {
  readonly root: string;
  readonly pin: string;
  readonly base: string;
  readonly pull: {
    readonly number: number;
    readonly url: string;
    readonly author: string;
    readonly base: string;
    readonly head: string;
    readonly commits: number;
  };
  readonly files: readonly {
    readonly path: string;
    readonly status: "A" | "M" | "D" | "R";
    readonly additions: number;
    readonly deletions: number;
    readonly oldPath?: string;
  }[];
  readonly notices: readonly PullNotice[];
}

export interface PrepareGenerationOptions {
  readonly cwd: string;
  readonly target: PrTarget;
  readonly useGh?: boolean;
}

export const prepareGeneration = Effect.fn("prepareGeneration")(function* (
  options: PrepareGenerationOptions,
) {
  const snapshot = yield* resolvePullHead({
    cwd: options.cwd,
    target: options.target,
    ...(options.useGh === undefined ? {} : { useGh: options.useGh }),
  });
  return {
    root: snapshot.root,
    pin: snapshot.pin,
    base: snapshot.base,
    pull: {
      number: snapshot.pull.number,
      url: snapshot.pull.url,
      author: snapshot.pull.author,
      base: snapshot.pull.base,
      head: snapshot.pull.head,
      commits: snapshot.pull.commits,
    },
    files: snapshot.files.map((file) => ({
      path: file.path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath }),
    })),
    notices: snapshot.notices,
  } satisfies PreparedGeneration;
});

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

export class RepairFailed extends Schema.TaggedErrorClass<RepairFailed>()("RepairFailed", {
  file: Schema.String,
  report: CheckReportSchema,
  cause: Schema.Defect(),
}) {}

export interface RunGenerationOptions {
  readonly source: PreparedGeneration;
  readonly model: AuthorModel;
  readonly directory: string;
  readonly progress: (event: AuthorProgress) => void;
  readonly verbose?: boolean;
  readonly useGh?: boolean;
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
  | AuthorSessionStartFailed
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
      files: options.source.files,
      model: options.model,
      verbose: options.verbose ?? false,
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
      .writeFileString(file, renderDraft(options.source, initial.draft), { flag: "wx" })
      .pipe(
        Effect.mapError((cause) =>
          cause.reason._tag === "AlreadyExists"
            ? new OutputAlreadyExists({ file })
            : new DraftWriteFailed({ file, cause }),
        ),
      );

    let turn = initial;
    let repairs = 0;
    let report = yield* checkGeneratedDraft(options, file);
    while (!report.ok && repairs < MAX_REPAIR_ATTEMPTS) {
      repairs++;
      turn = yield* session
        .repair(formatText({ reports: [report] }))
        .pipe(Effect.mapError((cause) => new RepairFailed({ file, report, cause })));
      yield* replaceDraft(fs, path, file, renderDraft(options.source, turn.draft)).pipe(
        Effect.mapError((cause) => new RepairFailed({ file, report, cause })),
      );
      report = yield* checkGeneratedDraft(options, file);
    }

    const summary: GenerationSummary = { file, report, usage: turn.usage, repairs };
    return report.ok
      ? ({ _tag: "Generated", ...summary } satisfies Generated)
      : ({ _tag: "GeneratedWithDiagnostics", ...summary } satisfies GeneratedWithDiagnostics);
  }).pipe(Effect.scoped),
);

const checkGeneratedDraft = Effect.fn("checkGeneratedDraft")(function* (
  options: RunGenerationOptions,
  file: string,
) {
  const outcome = yield* runCheck({
    cwd: options.source.root,
    paths: [file],
    ...(options.useGh === undefined ? {} : { useGh: options.useGh }),
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

const escapesRoot = (path: Path.Path, relative: string): boolean =>
  path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`);

const isGitMetadata = (path: Path.Path, relative: string): boolean =>
  relative.toLowerCase() === ".git" || relative.toLowerCase().startsWith(`.git${path.sep}`);

export function renderDraft(source: PreparedGeneration, draft: AuthorDraft): string {
  const frontmatter = stringifyYaml({
    walkthrough: 1,
    title: draft.title,
    pr: source.pull.number,
    commit: source.pin,
    meta: draft.meta,
    ...(draft.preset === undefined ? {} : { preset: draft.preset }),
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
    case "AuthorSessionStartFailed":
      return `Could not start ${error.provider}/${error.model}. Refresh authentication and try again.`;
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

function repairFailureMessage(cause: unknown): string {
  if (typeof cause !== "object" || cause === null || !("_tag" in cause)) {
    return "the replacement draft could not be produced";
  }
  switch (cause._tag) {
    case "ProviderRequestFailed":
      return "the provider stopped before submitting a replacement";
    case "DraftMalformed":
      return "the provider did not submit a valid replacement";
    case "DraftWriteFailed":
      return "the replacement could not be saved atomically";
    default:
      return "the replacement draft could not be produced";
  }
}
