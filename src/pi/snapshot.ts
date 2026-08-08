/** A filesystem snapshot containing only one pinned Git tree. */

import { Effect, FileSystem, Option, Path, Result, Schema } from "effect";
import { sha256 } from "../contract/hash.js";
import { CommandExecutor, type CommandExecutorShape } from "../shell.js";
import { escapesRoot, gitPath } from "../contract/paths.js";

const TREE_DIRECTORY = "tree";
const ACCESS_FILE = "accessed";
const ARCHIVE_FILE = "snapshot.tar";
const DEFAULT_MAXIMUM_ENTRIES = 5;
const PIN = /^[0-9a-f]{40,64}$/iu;
const REPOSITORY_CACHE_DIRECTORY = /^[a-z0-9._-]+-[0-9a-f]{16}$/iu;

export interface OpenPinnedRepositorySnapshotOptions {
  readonly cacheRoot: string;
  readonly repositoryRoot: string;
  readonly pin: string;
}

export interface ResolvedSnapshotPath {
  readonly absolute: string;
  readonly relative: string;
  readonly type: "File" | "Directory";
}

export interface PinnedRepositorySnapshot {
  /** Canonical path to the extracted tree. Nothing cache-specific lives below it. */
  readonly root: string;
  readonly listFiles: Effect.Effect<readonly string[], SnapshotReadFailed>;
  readonly resolvePath: (
    sourcePath: string,
  ) => Effect.Effect<ResolvedSnapshotPath, SnapshotPathRejected | SnapshotReadFailed>;
  readonly readFile: (
    sourcePath: string,
  ) => Effect.Effect<string, SnapshotPathRejected | SnapshotReadFailed>;
}

export class SnapshotOpenFailed extends Schema.TaggedErrorClass<SnapshotOpenFailed>()(
  "SnapshotOpenFailed",
  {
    repositoryRoot: Schema.String,
    pin: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class SnapshotPathRejected extends Schema.TaggedErrorClass<SnapshotPathRejected>()(
  "SnapshotPathRejected",
  { path: Schema.String, reason: Schema.String },
) {}

export class SnapshotReadFailed extends Schema.TaggedErrorClass<SnapshotReadFailed>()(
  "SnapshotReadFailed",
  { path: Schema.String, cause: Schema.Defect() },
) {}

interface CacheEntry {
  readonly directory: string;
  readonly accessedAt: number;
}

class SnapshotCacheRejected extends Schema.TaggedErrorClass<SnapshotCacheRejected>()(
  "SnapshotCacheRejected",
  { path: Schema.String, reason: Schema.String },
) {}

/**
 * Materialize or reuse a snapshot. Entries are built beside their final path,
 * then atomically renamed so concurrent readers never observe a partial tree.
 */
export const openPinnedRepositorySnapshot = Effect.fn("openPinnedRepositorySnapshot")(function* (
  options: OpenPinnedRepositorySnapshotOptions,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const commands = yield* CommandExecutor;

  if (!PIN.test(options.pin)) {
    return yield* new SnapshotOpenFailed({
      repositoryRoot: options.repositoryRoot,
      pin: options.pin,
      cause: new Error("The snapshot pin must be a full hexadecimal object id."),
    });
  }
  const pin = options.pin.toLowerCase();
  const opened = Effect.gen(function* () {
    const repositoryRoot = yield* fs.realPath(options.repositoryRoot);
    const requestedCacheRoot = path.resolve(options.cacheRoot);
    yield* fs.makeDirectory(requestedCacheRoot, { recursive: true });
    const cacheRoot = yield* fs.realPath(requestedCacheRoot);
    const repositoryKey = repositoryCacheKey(path, repositoryRoot);
    const requestedRepositoryDirectory = path.join(cacheRoot, repositoryKey);
    yield* fs.makeDirectory(requestedRepositoryDirectory, { recursive: true });
    const repositoryDirectory = yield* fs.realPath(requestedRepositoryDirectory);
    if (path.relative(cacheRoot, repositoryDirectory) !== repositoryKey) {
      return yield* new SnapshotCacheRejected({
        path: requestedRepositoryDirectory,
        reason: "The repository cache directory resolves outside its assigned location.",
      });
    }
    const entry = path.join(repositoryDirectory, pin);
    const tree = path.join(entry, TREE_DIRECTORY);

    if (!(yield* cacheEntryIsReady(fs, path, cacheRoot, entry))) {
      if (yield* fs.exists(entry)) yield* fs.remove(entry, { recursive: true, force: true });
      yield* materializeEntry(fs, path, commands, repositoryRoot, pin, cacheRoot, entry);
    }

    yield* touchEntry(fs, path, entry, pin);
    yield* cleanCache(fs, path, cacheRoot, entry).pipe(
      Effect.catch((cause) => Effect.logWarning("Snapshot cache cleanup failed", cause)),
    );
    const root = yield* fs.realPath(tree);
    const snapshot = makeSnapshot(fs, path, root);
    const listFiles = yield* Effect.cached(snapshot.listFiles);
    return { ...snapshot, listFiles };
  });

  return yield* opened.pipe(
    Effect.mapError(
      (cause) =>
        new SnapshotOpenFailed({
          repositoryRoot: options.repositoryRoot,
          pin: options.pin,
          cause,
        }),
    ),
  );
});

function makeSnapshot(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
): PinnedRepositorySnapshot {
  const resolvePath = Effect.fn("PinnedRepositorySnapshot.resolvePath")(function* (
    sourcePath: string,
  ) {
    const requested = sourcePath === "" ? "." : sourcePath.replace(/^\.\//u, "");
    const candidate = path.resolve(root, requested);
    if (escapesRoot(path, path.relative(root, candidate))) {
      return yield* new SnapshotPathRejected({
        path: sourcePath,
        reason: "The path escapes the pinned snapshot.",
      });
    }
    yield* rejectEscapingSymlinkSegments(fs, path, root, candidate, sourcePath);

    const canonical = yield* fs
      .realPath(candidate)
      .pipe(Effect.mapError((cause) => new SnapshotReadFailed({ path: sourcePath, cause })));
    if (escapesRoot(path, path.relative(root, canonical))) {
      return yield* new SnapshotPathRejected({
        path: sourcePath,
        reason: "The path resolves through a symlink outside the pinned snapshot.",
      });
    }
    const info = yield* fs
      .stat(canonical)
      .pipe(Effect.mapError((cause) => new SnapshotReadFailed({ path: sourcePath, cause })));
    const relative = gitPath(path, path.relative(root, candidate));
    if (info.type !== "File" && info.type !== "Directory") {
      return yield* new SnapshotPathRejected({
        path: sourcePath,
        reason: "The source path is neither a regular file nor a directory.",
      });
    }
    return {
      absolute: canonical,
      relative: relative === "" ? "." : relative,
      type: info.type,
    };
  });

  const listFiles = Effect.gen(function* () {
    const files: string[] = [];
    const directories = [root];
    while (directories.length > 0) {
      const directory = directories.pop();
      if (directory === undefined) break;
      const entries = yield* fs
        .readDirectory(directory)
        .pipe(Effect.mapError((cause) => new SnapshotReadFailed({ path: directory, cause })));
      for (const entry of entries) {
        const absolute = path.join(directory, entry);
        const relative = gitPath(path, path.relative(root, absolute));
        const link = yield* Effect.result(fs.readLink(absolute));
        if (Result.isSuccess(link)) {
          files.push(relative);
          continue;
        }

        const canonical = yield* fs
          .realPath(absolute)
          .pipe(Effect.mapError((cause) => new SnapshotReadFailed({ path: relative, cause })));
        if (escapesRoot(path, path.relative(root, canonical))) continue;
        const info = yield* fs
          .stat(canonical)
          .pipe(Effect.mapError((cause) => new SnapshotReadFailed({ path: relative, cause })));
        if (info.type === "File") files.push(relative);
        else if (info.type === "Directory") directories.push(canonical);
      }
    }
    return files.sort(compareText);
  }).pipe(Effect.withSpan("PinnedRepositorySnapshot.listFiles"));

  const readFile = Effect.fn("PinnedRepositorySnapshot.readFile")(function* (sourcePath: string) {
    const resolved = yield* resolvePath(sourcePath);
    if (resolved.type !== "File") {
      return yield* new SnapshotPathRejected({
        path: sourcePath,
        reason: "The source path is not a regular file.",
      });
    }
    return yield* fs
      .readFileString(resolved.absolute)
      .pipe(Effect.mapError((cause) => new SnapshotReadFailed({ path: sourcePath, cause })));
  });

  return { root, listFiles, resolvePath, readFile };
}

const rejectEscapingSymlinkSegments = Effect.fn("rejectEscapingSymlinkSegments")(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
  candidate: string,
  sourcePath: string,
) {
  let current = root;
  for (const segment of path.relative(root, candidate).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const link = yield* Effect.result(fs.readLink(current));
    if (Result.isFailure(link)) continue;
    const target = path.resolve(path.dirname(current), link.success);
    if (escapesRoot(path, path.relative(root, target))) {
      return yield* new SnapshotPathRejected({
        path: sourcePath,
        reason: "The path resolves through a symlink outside the pinned snapshot.",
      });
    }
  }
});

function materializeEntry(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  commands: CommandExecutorShape,
  repositoryRoot: string,
  pin: string,
  cacheRoot: string,
  entry: string,
) {
  const parent = path.dirname(entry);
  return Effect.acquireUseRelease(
    fs.makeTempDirectory({ directory: parent, prefix: `${pin}.` }),
    (temporary) =>
      Effect.gen(function* () {
        const tree = path.join(temporary, TREE_DIRECTORY);
        const archive = path.join(temporary, ARCHIVE_FILE);
        yield* fs.makeDirectory(tree);
        yield* commands.exec(
          "git",
          ["archive", "--format=tar", `--output=${archive}`, pin],
          repositoryRoot,
        );
        yield* commands.exec("tar", ["-xf", archive, "-C", tree], repositoryRoot);
        yield* fs.remove(archive);
        yield* touchEntry(fs, path, temporary, pin);

        const moved = yield* Effect.result(fs.rename(temporary, entry));
        if (Result.isSuccess(moved)) return;
        if (
          moved.failure.reason._tag !== "AlreadyExists" ||
          !(yield* cacheEntryIsReady(fs, path, cacheRoot, entry))
        ) {
          return yield* moved.failure;
        }
      }),
    (temporary) => fs.remove(temporary, { recursive: true, force: true }),
  );
}

function touchEntry(fs: FileSystem.FileSystem, path: Path.Path, entry: string, pin: string) {
  return fs.writeFileString(path.join(entry, ACCESS_FILE), `${pin}\n`);
}

function cacheEntryIsReady(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  cacheRoot: string,
  entry: string,
) {
  return Effect.gen(function* () {
    const access = path.join(entry, ACCESS_FILE);
    const tree = path.join(entry, TREE_DIRECTORY);
    if (!(yield* fs.exists(access)) || !(yield* fs.exists(tree))) return false;
    if (Result.isSuccess(yield* Effect.result(fs.readLink(entry)))) return false;

    const resolved = yield* Effect.result(
      Effect.all({
        entry: fs.realPath(entry),
        access: fs.realPath(access),
        tree: fs.realPath(tree),
      }),
    );
    if (Result.isFailure(resolved)) return false;
    const marker = yield* Effect.result(fs.readFileString(access));
    if (Result.isFailure(marker) || marker.success.trim() !== path.basename(entry)) return false;
    return (
      !escapesRoot(path, path.relative(cacheRoot, resolved.success.entry)) &&
      path.relative(resolved.success.entry, resolved.success.access) === ACCESS_FILE &&
      path.relative(resolved.success.entry, resolved.success.tree) === TREE_DIRECTORY
    );
  });
}

function cleanCache(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  cacheRoot: string,
  protectedEntry: string,
) {
  return Effect.gen(function* () {
    const repositories = (yield* fs.readDirectory(cacheRoot)).filter((name) =>
      REPOSITORY_CACHE_DIRECTORY.test(name),
    );
    const entries: CacheEntry[] = [];
    for (const repository of repositories) {
      const repositoryDirectory = path.join(cacheRoot, repository);
      if (Result.isSuccess(yield* Effect.result(fs.readLink(repositoryDirectory)))) continue;
      const pins = yield* fs.readDirectory(repositoryDirectory);
      for (const pin of pins.filter((name) => PIN.test(name))) {
        const directory = path.join(repositoryDirectory, pin);
        if (Result.isSuccess(yield* Effect.result(fs.readLink(directory)))) continue;
        if (!(yield* cacheEntryIsReady(fs, path, cacheRoot, directory))) continue;
        const info = yield* fs.stat(path.join(directory, ACCESS_FILE));
        entries.push({
          directory,
          accessedAt: Option.getOrElse(info.mtime, () => new Date(0)).getTime(),
        });
      }
    }

    const excess = Math.max(0, entries.length - DEFAULT_MAXIMUM_ENTRIES);
    const oldest = entries
      .filter((entry) => entry.directory !== protectedEntry)
      .sort((left, right) => {
        const time = left.accessedAt - right.accessedAt;
        return time === 0 ? compareText(left.directory, right.directory) : time;
      })
      .slice(0, excess);
    for (const entry of oldest) {
      yield* fs.remove(entry.directory, { recursive: true, force: true });
    }
  });
}

function repositoryCacheKey(path: Path.Path, repositoryRoot: string): string {
  const name = path
    .basename(repositoryRoot)
    .replace(/[^a-z0-9._-]+/giu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
  const digest = sha256(repositoryRoot).slice("sha256:".length, "sha256:".length + 16);
  return `${name === "" ? "repository" : name}-${digest}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
