/**
 * Repo-relative paths, spelled as git spells them: forward slashes on every
 * platform, computed between OS-final absolute paths.
 */

import { realpathSync } from "node:fs";
import { relative, sep } from "node:path";
import { Effect, Schema } from "effect";

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
  const finalRoot = yield* real(root);
  const finalAbsolute = yield* real(absolute);
  return relative(finalRoot, finalAbsolute).replaceAll(sep, "/");
});

/** The last segment of a git-spelled path. */
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/* `realpathSync.native` expands Windows 8.3 short names, which the portable
   implementation keeps. When the native call is unsupported the portable
   implementation gets one chance; a second failure stays typed. */
const real = (path: string) =>
  Effect.try({
    try: () => realpathSync.native(path),
    catch: (cause) => new PathResolutionFailed({ path, cause }),
  }).pipe(
    Effect.catchTag("PathResolutionFailed", () =>
      Effect.try({
        try: () => realpathSync(path),
        catch: (cause) => new PathResolutionFailed({ path, cause }),
      }),
    ),
  );
