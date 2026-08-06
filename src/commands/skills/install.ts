/**
 * The install writes: render the skill once, place it under each target
 * directory. Always overwrites — the file is generated, and re-running after
 * an upgrade is the whole refresh story.
 */

import { Effect, FileSystem, Path } from "effect";
import {
  CLAUDE_SKILL_LOCATION,
  renderSkillMd,
  SHARED_SKILL_LOCATION,
  SKILL_NAME,
} from "../../authoring/skill.js";
import { gitToplevel } from "../../shell.js";

export interface SkillsInstallOptions {
  cwd: string;
  /** One custom target directory instead of the conventional agent layouts. */
  out?: string;
}

/** Writes `<target>/balade-authoring/SKILL.md` per target; returns the written paths. */
export const runSkillsInstall = Effect.fn("runSkillsInstall")(function* (
  options: SkillsInstallOptions,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const bases: string[] = [];
  if (options.out === undefined) {
    const root = yield* gitToplevel(options.cwd);
    /* `.claude/` existing is the evidence the repository uses Claude Code. */
    const usesClaude = yield* fs.exists(path.join(root, path.dirname(CLAUDE_SKILL_LOCATION)));
    if (usesClaude) bases.push(path.join(root, CLAUDE_SKILL_LOCATION));
    bases.push(path.join(root, SHARED_SKILL_LOCATION));
  } else {
    bases.push(path.resolve(options.cwd, options.out));
  }
  const rendered = renderSkillMd();
  const written: string[] = [];
  for (const base of bases) {
    const dir = path.join(base, SKILL_NAME);
    yield* fs.makeDirectory(dir, { recursive: true });
    const file = path.join(dir, "SKILL.md");
    yield* fs.writeFileString(file, rendered);
    written.push(file);
  }
  return written;
});
