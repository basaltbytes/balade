/**
 * Repo-relative paths, spelled as git spells them: forward slashes on every
 * platform, computed between OS-final absolute paths.
 */

import { Effect, FileSystem, Path, Schema } from "effect";

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
  return path.relative(finalRoot, finalAbsolute).replaceAll(path.sep, "/");
});

/** The last segment of a git-spelled path. */
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The platform adapter returns the operating system's final path spelling. */
const real = (fs: FileSystem.FileSystem, path: string) =>
  fs.realPath(path).pipe(Effect.mapError((cause) => new PathResolutionFailed({ path, cause })));
