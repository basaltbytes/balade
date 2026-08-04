/**
 * Repo-relative paths, spelled as git spells them: forward slashes on every
 * platform, computed between OS-final absolute paths.
 */

import { Effect, FileSystem, Option, Path, Schema } from "effect";

export class PathResolutionFailed extends Schema.TaggedErrorClass<PathResolutionFailed>()(
  "PathResolutionFailed",
  { path: Schema.String, cause: Schema.Defect() },
) {}

/**
 * `absolute` relative to `root`, as git spells it. `git rev-parse` answers
 * final long paths, while a caller may hold a symlinked (`/var` on macOS) or
 * 8.3 short-name (`RUNNER~1` on Windows) spelling of the same place, which
 * would otherwise turn the relative path into a climb out of the repo.
 */
export const repoRelative = Effect.fn("repoRelative")(function* (root: string, absolute: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const finalRoot = yield* real(fs, root);
  const finalAbsolute = yield* real(fs, absolute);
  const relative = path.relative(finalRoot, finalAbsolute);
  if (!escapesRoot(path, relative)) return gitPath(path, relative);

  const rootInfo = yield* stat(fs, finalRoot);
  const segments: string[] = [];
  let current = finalAbsolute;
  while (true) {
    if (sameFile(rootInfo, yield* stat(fs, current))) return segments.reverse().join("/");
    const parent = path.dirname(current);
    if (parent === current) return gitPath(path, relative);
    segments.push(path.basename(current));
    current = parent;
  }
});

/** The last segment of a git-spelled path. */
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The platform adapter returns the operating system's final path spelling. */
const real = (fs: FileSystem.FileSystem, path: string) =>
  fs.realPath(path).pipe(Effect.mapError((cause) => new PathResolutionFailed({ path, cause })));

const stat = (fs: FileSystem.FileSystem, path: string) =>
  fs.stat(path).pipe(Effect.mapError((cause) => new PathResolutionFailed({ path, cause })));

export const escapesRoot = (path: Path.Path, relative: string): boolean =>
  relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);

export const gitPath = (path: Path.Path, value: string): string => value.replaceAll(path.sep, "/");

const sameFile = (left: FileSystem.File.Info, right: FileSystem.File.Info) =>
  left.dev === right.dev &&
  Option.isSome(left.ino) &&
  Option.isSome(right.ino) &&
  left.ino.value === right.ino.value;
