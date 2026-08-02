/**
 * Frontmatter envelope: required `walkthrough`, `title`, `pr`, `commit`;
 * optional `meta` map and `preset`; every other top-level key is an error.
 */

import { parse as parseYaml } from "yaml";
import { isRecord } from "../payload/parse-review.js";
import type { CheckDiagnostic } from "../payload/types.js";

const SCHEMA_VERSION = 1;

export interface Frontmatter {
  walkthrough: 1;
  title: string;
  pr: number;
  commit: string;
  meta: Record<string, string>;
  preset?: string;
}

const REQUIRED = ["walkthrough", "title", "pr", "commit"] as const;
const OPTIONAL = ["meta", "preset"] as const;
const KNOWN: readonly string[] = [...REQUIRED, ...OPTIONAL];

export interface FrontmatterResult {
  frontmatter: Frontmatter | null;
  diagnostics: CheckDiagnostic[];
}

/**
 * The YAML between the leading `---` fences, or `null` when the file opens with
 * something else. Callers that only need the envelope read this instead of
 * paying for a Markdoc parse.
 */
export function frontmatterBlock(source: string): string | null {
  const firstBreak = source.indexOf("\n");
  if (firstBreak === -1 || source.slice(0, firstBreak).trim() !== "---") return null;
  const end = source.indexOf("\n---", firstBreak);
  return end === -1 ? null : source.slice(firstBreak + 1, end + 1);
}

/** 1-based line of a top-level frontmatter key, for file:line diagnostics. */
export function frontmatterLine(raw: string, key: string): number {
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (new RegExp(`^${key}\\s*:`).test(lines[i] ?? "")) return i + 2;
  }
  return 1;
}

export function parseFrontmatter(raw: string, file: string): FrontmatterResult {
  const diagnostics: CheckDiagnostic[] = [];
  if (raw.trim() === "") {
    diagnostics.push({
      code: "frontmatter-missing",
      level: "error",
      file,
      line: 1,
      message: "The walkthrough file has no frontmatter.",
      hint: "Start the file with a `---` block that holds walkthrough: 1, title, pr and commit.",
    });
    return { frontmatter: null, diagnostics };
  }

  let data: unknown;
  try {
    data = parseYaml(raw);
  } catch (error) {
    diagnostics.push({
      code: "frontmatter-invalid",
      level: "error",
      file,
      line: 1,
      message: `The frontmatter is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
      hint: "Quote values that hold a colon, and keep the indentation consistent.",
    });
    return { frontmatter: null, diagnostics };
  }

  if (!isRecord(data)) {
    diagnostics.push({
      code: "frontmatter-invalid",
      level: "error",
      file,
      line: 1,
      message: "The frontmatter must be a map of keys.",
      hint: "Write `title: …` lines, not a list or a scalar.",
    });
    return { frontmatter: null, diagnostics };
  }

  const map = data;
  const at = (key: string): number => frontmatterLine(raw, key);
  /* Only a broken envelope stops resolution; everything else keeps the one-pass report. */
  let stopped = false;
  const bad = (
    code: string,
    key: string,
    message: string,
    hint: string,
    options: { stopsResolution: boolean } = { stopsResolution: true },
  ): void => {
    diagnostics.push({ code, level: "error", file, line: at(key), message, hint });
    if (options.stopsResolution) stopped = true;
  };

  for (const key of Object.keys(map)) {
    if (!KNOWN.includes(key)) {
      bad(
        "frontmatter-key-unknown",
        key,
        `Unknown frontmatter key \`${key}\`.`,
        `Keep domain keys under \`meta\`: meta:\n  ${key}: …`,
        { stopsResolution: false },
      );
    }
  }
  for (const key of REQUIRED) {
    if (map[key] === undefined) {
      bad("frontmatter-invalid", key, `The frontmatter misses \`${key}\`.`, requiredHint(key));
    }
  }

  const version = map["walkthrough"];
  if (version !== undefined && version !== SCHEMA_VERSION) {
    bad(
      "frontmatter-invalid",
      "walkthrough",
      `Unsupported schema version \`${String(version)}\`.`,
      `This build reads schema version ${SCHEMA_VERSION}. Write \`walkthrough: ${SCHEMA_VERSION}\`, or run a newer balade.`,
    );
  }
  let title: string | undefined;
  const rawTitle = map["title"];
  if (rawTitle !== undefined) {
    if (typeof rawTitle === "string") title = rawTitle;
    else bad("frontmatter-invalid", "title", "`title` must be a string.", 'Write `title: "…"`.');
  }

  let pr: number | undefined;
  const rawPr = map["pr"];
  if (rawPr !== undefined) {
    if (typeof rawPr === "number" && Number.isInteger(rawPr)) pr = rawPr;
    else
      bad(
        "frontmatter-invalid",
        "pr",
        "`pr` must be the pull-request number.",
        "Write `pr: 96`, without quotes or a `#`.",
      );
  }

  let commit: string | undefined;
  const rawCommit = map["commit"];
  if (rawCommit !== undefined) {
    if (typeof rawCommit === "string" && /^[0-9a-f]{7,40}$/i.test(rawCommit)) commit = rawCommit;
    else
      bad(
        "frontmatter-invalid",
        "commit",
        "`commit` must be the stamped commit SHA.",
        "Write the SHA of the PR head you authored against: `commit: 9f3c2ad…`.",
      );
  }

  let preset: string | undefined;
  const rawPreset = map["preset"];
  if (rawPreset !== undefined) {
    if (typeof rawPreset === "string") preset = rawPreset;
    else
      bad(
        "frontmatter-invalid",
        "preset",
        "`preset` must be a preset name.",
        "Write `preset: odoo`.",
        {
          stopsResolution: false,
        },
      );
  }

  const meta: Record<string, string> = {};
  const rawMeta = map["meta"];
  if (rawMeta !== undefined) {
    if (!isRecord(rawMeta)) {
      bad(
        "frontmatter-invalid",
        "meta",
        "`meta` must be a map of domain keys.",
        "Write `meta:` then indented `key: value` lines.",
        {
          stopsResolution: false,
        },
      );
    } else {
      for (const [key, value] of Object.entries(rawMeta)) {
        if (value === null || typeof value === "object") {
          bad(
            "frontmatter-invalid",
            "meta",
            `\`meta.${key}\` must be a scalar.`,
            "Meta values render as header chips; keep them short strings.",
            {
              stopsResolution: false,
            },
          );
          continue;
        }
        meta[key] = String(value);
      }
    }
  }

  if (stopped || title === undefined || pr === undefined || commit === undefined) {
    return { frontmatter: null, diagnostics };
  }

  const frontmatter: Frontmatter = {
    walkthrough: SCHEMA_VERSION,
    title,
    pr,
    commit,
    meta,
    ...(preset !== undefined ? { preset } : {}),
  };
  return { frontmatter, diagnostics };
}

function requiredHint(key: string): string {
  switch (key) {
    case "walkthrough":
      return `Write \`walkthrough: ${SCHEMA_VERSION}\` — it declares the schema version.`;
    case "title":
      return 'Write `title: "…"` — it heads the walkthrough.';
    case "pr":
      return "Write `pr: 96` — the pull-request number the walkthrough describes.";
    default:
      return "Write `commit: <sha>` — the commit the walkthrough was authored against.";
  }
}
