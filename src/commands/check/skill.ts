/**
 * The staleness guard: `check` verifies the installed authoring skill without
 * owning its placement. Silent when the skill is absent or current; one
 * stderr hint line when a stamped version differs from the CLI's. Never a
 * diagnostic, never the exit code.
 */

import { Effect, FileSystem, Path } from "effect";
import { AUTHORING_META_KEY, AUTHORING_PACKAGE_VERSION } from "../../authoring/package.js";
import { SKILL_LOCATIONS } from "../../authoring/skill.js";
import { gitToplevel } from "../../shell.js";
import { frontmatterBlock } from "../../walkthrough/frontmatter.js";

interface SkillStamp {
  /** Repo-relative path of the stamped SKILL.md. */
  file: string;
  version: string;
}

const STAMP = new RegExp(`^${AUTHORING_META_KEY}\\s*:\\s*(\\S+)\\s*$`, "m");

/** Every SKILL.md under the known skills directories that carries the stamp key. */
const findSkillStamps = Effect.fn("findSkillStamps")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const stamps: SkillStamp[] = [];
  for (const location of SKILL_LOCATIONS) {
    const entries = yield* fs
      .readDirectory(path.join(root, location))
      .pipe(Effect.orElseSucceed(() => []));
    for (const entry of entries.toSorted()) {
      const source = yield* fs
        .readFileString(path.join(root, location, entry, "SKILL.md"))
        .pipe(Effect.orElseSucceed(() => ""));
      const block = frontmatterBlock(source);
      const version = block === null ? null : STAMP.exec(block)?.[1];
      if (version != null) stamps.push({ file: `${location}/${entry}/SKILL.md`, version });
    }
  }
  return stamps;
});

/** Numeric semver order; an unparsable stamp sorts as oldest, so it hints re-install. */
function olderThanCli(version: string): boolean {
  const stamped = version.split(".").map(Number);
  const cli = AUTHORING_PACKAGE_VERSION.split(".").map(Number);
  for (let i = 0; i < cli.length; i++) {
    const a = stamped[i] ?? 0;
    const b = cli[i] ?? 0;
    if (Number.isNaN(a) || a < b) return true;
    if (a > b) return false;
  }
  return true;
}

/**
 * The hint lines for the current repository; empty when everything is current,
 * absent, or the cwd is not a repository. Never fails.
 */
export const skillStalenessHints = Effect.fn("skillStalenessHints")(function* (cwd: string) {
  const stamps = yield* gitToplevel(cwd).pipe(
    Effect.flatMap(findSkillStamps),
    Effect.orElseSucceed(() => []),
  );
  return stamps
    .filter((stamp) => stamp.version !== AUTHORING_PACKAGE_VERSION)
    .map((stamp) =>
      olderThanCli(stamp.version)
        ? `hint ${stamp.file} teaches authoring package ${stamp.version}; this balade ships ${AUTHORING_PACKAGE_VERSION}. Refresh it with \`balade skills install\`.`
        : `hint ${stamp.file} teaches authoring package ${stamp.version}; this balade ships ${AUTHORING_PACKAGE_VERSION}. Upgrade balade to match it.`,
    );
});
