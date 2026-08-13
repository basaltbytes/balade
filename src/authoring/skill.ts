/**
 * The second rendering of the authoring package: a generated SKILL.md that
 * teaches an external coding agent to author walkthroughs by hand. `balade
 * skills install` materializes it; `balade check` reads its frontmatter stamp
 * back. The skill is generated output, never a source — `skill.md` beside
 * this module carries its prose, and the typed data and shared guidance in
 * this module's siblings stay the single authority.
 */

import { sharedGuidance } from "./guidance.js";
import {
  AUTHORING_META_KEY,
  AUTHORING_PACKAGE_VERSION,
  AUTHORING_WALKTHROUGH_SCHEMA_VERSION,
} from "./package.js";
import { proseTemplate, renderProse } from "./prose.js";

/** Directory name of the installed skill inside each agent's skills folder. */
export const SKILL_NAME = "balade-authoring";

/**
 * The shared skills convention most agents read (Codex, opencode, Cursor, and
 * recent Claude Code among them); install always writes it.
 */
export const SHARED_SKILL_LOCATION = ".agents/skills";

/**
 * Claude Code's own layout; install writes it only when `.claude/` already
 * exists, so a repository that never uses Claude Code never grows the folder.
 */
export const CLAUDE_SKILL_LOCATION = ".claude/skills";

/** Repo-relative skills directories `check` scans for a stamped skill. */
export const SKILL_LOCATIONS = [CLAUDE_SKILL_LOCATION, SHARED_SKILL_LOCATION] as const;

/** The complete generated SKILL.md, stamped with the authoring version. */
export function skillMd(): string {
  return renderProse(proseTemplate(import.meta.url, "skill.md"), {
    "skill-name": SKILL_NAME,
    "meta-key": AUTHORING_META_KEY,
    "package-version": AUTHORING_PACKAGE_VERSION,
    "schema-version": String(AUTHORING_WALKTHROUGH_SCHEMA_VERSION),
    "shared-guidance": sharedGuidance("markdown"),
  });
}
