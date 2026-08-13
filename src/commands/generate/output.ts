/** Safe output discovery, exclusive creation, collision recovery and atomic replacement. */

import { Effect, FileSystem, Path, Result, Schema } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { escapesRoot } from "../../contract/paths.js";
import { frontmatterBlock, parseFrontmatter } from "../../walkthrough/frontmatter.js";

export class OutputOutsideRepository extends Schema.TaggedErrorClass<OutputOutsideRepository>()(
  "OutputOutsideRepository",
  { directory: Schema.String, root: Schema.String },
) {}

export class DraftWriteFailed extends Schema.TaggedErrorClass<DraftWriteFailed>()(
  "DraftWriteFailed",
  {
    file: Schema.String,
    operation: Schema.Literals(["write", "replace"]),
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

export class ExistingSameHead extends Schema.TaggedClass<ExistingSameHead>()(
  "ExistingSameHead",
  {},
) {}

export class ExistingDifferentHead extends Schema.TaggedClass<ExistingDifferentHead>()(
  "ExistingDifferentHead",
  { pin: Schema.String },
) {}

export class ExistingStampInvalid extends Schema.TaggedClass<ExistingStampInvalid>()(
  "ExistingStampInvalid",
  {},
) {}

export class ExistingStampUnreadable extends Schema.TaggedClass<ExistingStampUnreadable>()(
  "ExistingStampUnreadable",
  { reason: Schema.String, cause: Schema.Defect() },
) {}

const ExistingStamp = Schema.Union([
  ExistingSameHead,
  ExistingDifferentHead,
  ExistingStampInvalid,
  ExistingStampUnreadable,
]);
export type ExistingStamp = typeof ExistingStamp.Type;

export class OutputAlreadyExists extends Schema.TaggedErrorClass<OutputAlreadyExists>()(
  "OutputAlreadyExists",
  {
    file: Schema.String,
    retainedFile: Schema.String,
    currentHead: Schema.String,
    existing: ExistingStamp,
  },
) {}

export interface GenerationOutputTarget {
  readonly root: string;
  readonly directory: string;
  readonly pullNumber: number;
}

export interface WriteGenerationDraftOptions extends GenerationOutputTarget {
  readonly title: string;
  readonly contents: string;
  readonly currentHead: string;
  readonly collisionPolicy: CollisionPolicy;
}

export type CollisionPolicy = "exclusive" | "replace";

export interface WrittenGenerationDraft {
  readonly file: string;
  readonly siblings: readonly string[];
}

/** Find likely prior outputs without creating the requested directory. */
export const findGeneratedWalkthroughs = Effect.fn("findGeneratedWalkthroughs")(
  (target: GenerationOutputTarget) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const output = yield* validateOutputDirectory(fs, path, target.root, target.directory);
      return yield* listPullWalkthroughs(fs, path, target.root, output, target.pullNumber);
    }),
);

/** Write one completed authoring turn according to the command's clobber policy. */
export const writeGenerationDraft = Effect.fn("writeGenerationDraft")(
  (options: WriteGenerationDraftOptions) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const output = yield* validateOutputDirectory(fs, path, options.root, options.directory);
      yield* prepareOutputDirectory(fs, path, options.root, output, options.directory);

      const file = path.join(output, `pr-${options.pullNumber}-${slugifyTitle(options.title)}.md`);
      if (options.collisionPolicy === "replace") {
        yield* replaceGeneratedDraft(file, options.contents);
      } else {
        yield* writeExclusive(fs, path, file, options.contents, options.currentHead);
      }

      const relativeFile = path.relative(options.root, file);
      const siblings = (yield* listPullWalkthroughs(
        fs,
        path,
        options.root,
        output,
        options.pullNumber,
      )).filter((candidate) => candidate !== relativeFile);
      return { file, siblings } satisfies WrittenGenerationDraft;
    }),
);

/** Repairs and forced writes replace one known file through a same-directory rename. */
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

const writeExclusive = Effect.fn("writeGenerationDraft.exclusive")(
  (
    fs: FileSystem.FileSystem,
    path: Path.Path,
    file: string,
    contents: string,
    currentHead: string,
  ) =>
    fs.writeFileString(file, contents, { flag: "wx" }).pipe(
      Effect.catch((cause) =>
        Effect.gen(function* () {
          if (cause.reason._tag === "AlreadyExists") {
            return yield* retainCollision(fs, path, file, contents, currentHead);
          }
          return yield* new DraftWriteFailed({
            file,
            operation: "write",
            reason: platformReason(cause),
            cause,
          });
        }),
      ),
    ),
);

const retainCollision = Effect.fn("writeGenerationDraft.retainCollision")(
  (
    fs: FileSystem.FileSystem,
    path: Path.Path,
    file: string,
    contents: string,
    currentHead: string,
  ) =>
    Effect.gen(function* () {
      const retainedFile = yield* retainCompletedDraft(fs, path, file, contents);
      const existing = yield* inspectExistingStamp(fs, file, currentHead);
      return yield* new OutputAlreadyExists({ file, retainedFile, currentHead, existing });
    }),
);

const retainCompletedDraft = Effect.fn("retainCompletedDraft")(
  (fs: FileSystem.FileSystem, path: Path.Path, file: string, contents: string) =>
    Effect.gen(function* () {
      const temporary = yield* fs.makeTempFileScoped({
        directory: path.dirname(file),
        prefix: ".balade-recovery-",
      });
      const token = `${path.basename(path.dirname(temporary))}-${path.basename(temporary)}`.slice(
        ".balade-recovery-".length,
      );
      const retainedFile = path.join(
        path.dirname(file),
        `${path.basename(file, ".md")}-recovered-${token}.md`,
      );
      yield* fs.writeFileString(temporary, contents);
      yield* fs.rename(temporary, retainedFile);
      return retainedFile;
    }).pipe(
      Effect.scoped,
      Effect.mapError(
        (cause) => new DraftRetentionFailed({ file, reason: platformReason(cause), cause }),
      ),
    ),
);

const inspectExistingStamp = Effect.fn("inspectExistingStamp")(function* (
  fs: FileSystem.FileSystem,
  file: string,
  currentHead: string,
) {
  const contents = yield* Effect.result(fs.readFileString(file));
  if (Result.isFailure(contents)) {
    return new ExistingStampUnreadable({
      reason: platformReason(contents.failure),
      cause: contents.failure,
    });
  }
  const block = frontmatterBlock(contents.success);
  if (block === null) return new ExistingStampInvalid();
  const existing = parseFrontmatter(block, file).frontmatter;
  if (existing === null) return new ExistingStampInvalid();
  return existing.commit === currentHead
    ? new ExistingSameHead()
    : new ExistingDifferentHead({ pin: existing.commit });
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
    .map((entry) => path.relative(root, path.join(output, entry)))
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
