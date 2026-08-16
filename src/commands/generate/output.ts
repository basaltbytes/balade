/** Safe output discovery, pre-flight supersession planning and atomic replacement. */

import { Effect, FileSystem, Path, Result, Schema } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { escapesRoot, gitPath } from "../../contract/paths.js";
import type { Lang } from "../../contract/types.js";
import { gitOut } from "../../shell.js";
import { frontmatterBlock, parseFrontmatter } from "../../walkthrough/frontmatter.js";

export class OutputOutsideRepository extends Schema.TaggedErrorClass<OutputOutsideRepository>()(
  "OutputOutsideRepository",
  { directory: Schema.String, root: Schema.String },
) {}

export class DraftWriteFailed extends Schema.TaggedErrorClass<DraftWriteFailed>()(
  "DraftWriteFailed",
  {
    file: Schema.String,
    operation: Schema.Literals(["replace", "remove"]),
    reason: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class DraftRetentionFailed extends Schema.TaggedErrorClass<DraftRetentionFailed>()(
  "DraftRetentionFailed",
  { file: Schema.String, reason: Schema.String, cause: Schema.Defect() },
) {}

export class OutputAccessFailed extends Schema.TaggedErrorClass<OutputAccessFailed>()(
  "OutputAccessFailed",
  {
    path: Schema.String,
    operation: Schema.Literals(["resolve", "list", "prepare"]),
    reason: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export interface StampedExisting {
  readonly _tag: "Stamped";
  readonly pin: string;
  readonly lang: Lang;
}

/** The stamp cannot be read or parsed, so neither its head nor its language is known. */
export interface UnstampedExisting {
  readonly _tag: "Unstamped";
}

export type ExistingStamp = StampedExisting | UnstampedExisting;

/** One existing same-PR walkthrough, read before the paid authoring turn. */
export interface ExistingWalkthrough {
  readonly file: string;
  readonly relativeFile: string;
  readonly stamp: ExistingStamp;
}

export interface RefreshingWalkthrough extends ExistingWalkthrough {
  readonly stamp: StampedExisting;
}

/**
 * The pre-flight overwrite decision, split by how each same-identity file is
 * stamped. Identity is (PR, lang): a stamped different-language walkthrough
 * never conflicts and appears in neither list.
 */
export interface SupersessionPlan {
  /** Stamped at an older head: refreshing is unambiguous intent, announce and proceed. */
  readonly refreshing: readonly RefreshingWalkthrough[];
  /** Stamped at the current head, or unreadable: replacing needs the operator's say-so. */
  readonly undecided: readonly ExistingWalkthrough[];
}

export interface GenerationOutputTarget {
  readonly root: string;
  readonly directory: string;
  readonly pullNumber: number;
}

export interface WriteGenerationDraftOptions extends GenerationOutputTarget {
  readonly title: string;
  readonly contents: string;
  /** Same-identity files resolved for replacement before the paid turn began. */
  readonly supersede: readonly ExistingWalkthrough[];
}

export interface SupersededWalkthrough {
  /** Repository-relative walkthrough this run replaced or removed. */
  readonly file: string;
  /** Repository-relative copy kept beside it when its content was not committed. */
  readonly retainedAt?: string;
}

export interface WrittenGenerationDraft {
  readonly file: string;
  readonly siblings: readonly string[];
  readonly superseded: readonly SupersededWalkthrough[];
}

/** The directory checks alone, so a bad `--dir` fails before any paid turn. */
export const validateGenerationOutput = Effect.fn("validateGenerationOutput")(
  (target: GenerationOutputTarget) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* validateOutputDirectory(fs, path, target.root, target.directory);
    }),
);

/** Read every same-PR walkthrough's stamp without creating the requested directory. */
export const inspectExistingWalkthroughs = Effect.fn("inspectExistingWalkthroughs")(
  (target: GenerationOutputTarget) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const output = yield* validateOutputDirectory(fs, path, target.root, target.directory);
      const files = yield* listPullWalkthroughs(fs, path, target.root, output, target.pullNumber);
      return yield* Effect.forEach(files, (relativeFile) =>
        Effect.gen(function* () {
          const file = path.join(target.root, relativeFile);
          const stamp = yield* readExistingStamp(fs, file);
          return { file, relativeFile, stamp } satisfies ExistingWalkthrough;
        }),
      );
    }),
);

/**
 * Decide before the model runs which existing files this run supersedes.
 * An unreadable stamp cannot prove a different identity, so it conflicts with
 * every run for the PR and is grouped with the current-head files: replacing
 * either is a decision, not a refresh.
 */
export function planSupersession(
  existing: readonly ExistingWalkthrough[],
  currentHead: string,
  lang: Lang,
): SupersessionPlan {
  const refreshing: RefreshingWalkthrough[] = [];
  const undecided: ExistingWalkthrough[] = [];
  for (const candidate of existing) {
    const stamp = candidate.stamp;
    if (stamp._tag === "Unstamped") {
      undecided.push(candidate);
    } else if (stamp.lang === lang) {
      if (stamp.pin === currentHead) undecided.push(candidate);
      else refreshing.push({ ...candidate, stamp });
    }
  }
  return { refreshing, undecided };
}

/**
 * Write one completed authoring turn and supersede the files the pre-flight
 * plan resolved. The write itself can no longer fail on a collision, so the
 * check and repair loop after it always runs. Committed superseded content
 * needs no copy — git is its safety net; uncommitted content is retained
 * beside the output before anything replaces or removes it.
 */
export const writeGenerationDraft = Effect.fn("writeGenerationDraft")(
  (options: WriteGenerationDraftOptions) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const output = yield* validateOutputDirectory(fs, path, options.root, options.directory);
      yield* prepareOutputDirectory(fs, path, options.root, output, options.directory);

      const file = path.join(output, `pr-${options.pullNumber}-${slugifyTitle(options.title)}.md`);
      const superseded: SupersededWalkthrough[] = [];
      for (const existing of options.supersede) {
        const retainedAt = yield* retainUncommittedContent(fs, options.root, existing);
        superseded.push(
          retainedAt === undefined
            ? { file: existing.relativeFile }
            : { file: existing.relativeFile, retainedAt },
        );
      }
      yield* replaceGeneratedDraft(file, options.contents);
      for (const existing of options.supersede) {
        if (path.resolve(existing.file) === path.resolve(file)) continue;
        yield* fs.remove(existing.file, { force: true }).pipe(
          Effect.mapError(
            (cause) =>
              new DraftWriteFailed({
                file: existing.relativeFile,
                operation: "remove",
                reason: platformReason(cause),
                cause,
              }),
          ),
        );
      }

      const relativeFile = gitPath(path, path.relative(options.root, file));
      const siblings = (yield* listPullWalkthroughs(
        fs,
        path,
        options.root,
        output,
        options.pullNumber,
      )).filter((candidate) => candidate !== relativeFile);
      return { file, siblings, superseded } satisfies WrittenGenerationDraft;
    }),
);

/** Repairs and generation writes replace one known file through a same-directory rename. */
export const replaceGeneratedDraft = Effect.fn("replaceGeneratedDraft")(
  (file: string, contents: string) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const temporary = yield* fs.makeTempFileScoped({
        directory: path.dirname(file),
        prefix: ".balade-write-",
      });
      yield* fs.writeFileString(temporary, contents);
      yield* fs.rename(temporary, file);
    }).pipe(
      Effect.scoped,
      Effect.mapError(
        (cause) =>
          new DraftWriteFailed({
            file,
            operation: "replace",
            reason: platformReason(cause),
            cause,
          }),
      ),
    ),
);

/**
 * A fixed `<file>.superseded` name keeps retention bounded — a later run
 * overwrites the copy instead of accumulating siblings — and keeps the copy
 * out of walkthrough discovery, which only matches `.md`. The content is
 * re-read at write time: the file may have changed during the paid turn.
 */
const retainUncommittedContent = Effect.fn("retainUncommittedContent")(function* (
  fs: FileSystem.FileSystem,
  root: string,
  existing: ExistingWalkthrough,
) {
  const status = yield* gitOut(["status", "--porcelain", "--", existing.relativeFile], root);
  if (status.trim() === "") return undefined;
  const contents = yield* Effect.result(fs.readFileString(existing.file));
  if (Result.isFailure(contents)) return undefined;
  yield* fs.writeFileString(`${existing.file}.superseded`, contents.success).pipe(
    Effect.mapError(
      (cause) =>
        new DraftRetentionFailed({
          file: existing.relativeFile,
          reason: platformReason(cause),
          cause,
        }),
    ),
  );
  return `${existing.relativeFile}.superseded`;
});

const readExistingStamp = Effect.fn("readExistingStamp")(function* (
  fs: FileSystem.FileSystem,
  file: string,
) {
  const contents = yield* Effect.result(fs.readFileString(file));
  if (Result.isFailure(contents)) return { _tag: "Unstamped" } as const satisfies ExistingStamp;
  const block = frontmatterBlock(contents.success);
  if (block === null) return { _tag: "Unstamped" } as const satisfies ExistingStamp;
  const existing = parseFrontmatter(block, file).frontmatter;
  if (existing === null) return { _tag: "Unstamped" } as const satisfies ExistingStamp;
  return {
    _tag: "Stamped",
    pin: existing.commit,
    lang: existing.meta["lang"] === "fr" ? "fr" : "en",
  } as const satisfies ExistingStamp;
});

const listPullWalkthroughs = Effect.fn("listPullWalkthroughs")(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
  output: string,
  pullNumber: number,
) {
  const entries = yield* fs.readDirectory(output).pipe(
    Effect.catch((cause) =>
      cause.reason._tag === "NotFound"
        ? Effect.succeed([])
        : new OutputAccessFailed({
            path: output,
            operation: "list",
            reason: platformReason(cause),
            cause,
          }),
    ),
  );
  const prefix = `pr-${pullNumber}-`;
  return entries
    .filter((entry) => entry.startsWith(prefix) && entry.endsWith(".md"))
    .map((entry) => gitPath(path, path.relative(root, path.join(output, entry))))
    .sort((left, right) => left.localeCompare(right));
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
  const canonicalRoot = yield* fs.realPath(root).pipe(
    Effect.mapError(
      (cause) =>
        new OutputAccessFailed({
          path: root,
          operation: "resolve",
          reason: platformReason(cause),
          cause,
        }),
    ),
  );
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
      return yield* new OutputAccessFailed({
        path: current,
        operation: "resolve",
        reason: platformReason(resolved.failure),
        cause: resolved.failure,
      });
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return yield* new OutputAccessFailed({
        path: requested,
        operation: "resolve",
        reason: platformReason(resolved.failure),
        cause: resolved.failure,
      });
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
  yield* fs.makeDirectory(output, { recursive: true }).pipe(
    Effect.mapError(
      (cause) =>
        new OutputAccessFailed({
          path: output,
          operation: "prepare",
          reason: platformReason(cause),
          cause,
        }),
    ),
  );
  const [canonicalRoot, canonicalOutput] = yield* Effect.all([
    fs.realPath(root),
    fs.realPath(output),
  ]).pipe(
    Effect.mapError(
      (cause) =>
        new OutputAccessFailed({
          path: output,
          operation: "prepare",
          reason: platformReason(cause),
          cause,
        }),
    ),
  );
  if (escapesRoot(path, path.relative(canonicalRoot, canonicalOutput))) {
    return yield* new OutputOutsideRepository({ directory: requested, root });
  }
});

const isGitMetadata = (path: Path.Path, relative: string): boolean =>
  relative.toLowerCase() === ".git" || relative.toLowerCase().startsWith(`.git${path.sep}`);

const platformReason = (cause: PlatformError): string => cause.reason._tag;

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
