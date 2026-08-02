/**
 * Repo-relative paths, spelled as git spells them: forward slashes on every
 * platform, computed between OS-final absolute paths.
 */

import { realpathSync } from "node:fs";
import { relative, sep } from "node:path";

/**
 * `absolute` relative to `root`, as git spells it. `git rev-parse` answers
 * final long paths, while a caller may hold a symlinked (`/var` on macOS) or
 * 8.3 short-name (`RUNNER~1` on Windows) spelling of the same place, which
 * would otherwise turn the relative path into a climb out of the repo.
 */
export function repoRelative(root: string, absolute: string): string {
  return relative(real(root), real(absolute)).replaceAll(sep, "/");
}

/** The last segment of a git-spelled path. */
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/* `realpathSync.native` expands Windows 8.3 short names, which the portable
   implementation keeps; where the OS call is unsupported the portable answer
   still resolves symlinks, and a path that resolves nowhere answers itself. */
function real(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  }
}
