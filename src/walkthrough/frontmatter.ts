/**
 * Frontmatter envelope: required `walkthrough`, `title`, `pr`, `commit`;
 * optional `meta` map and `preset`; every other top-level key is an error.
 */

import { Predicate, Result, Schema, SchemaIssue } from "effect";
import { Frontmatter as FrontmatterSchema } from "../contract/schema.js";
import type { CheckDiagnostic, Frontmatter as FrontmatterType } from "../contract/types.js";
import { parse as parseYaml } from "yaml";

export type { Frontmatter } from "../contract/types.js";

const SCHEMA_VERSION = 1;

const REQUIRED = ["walkthrough", "title", "pr", "commit"] as const;
const OPTIONAL = ["meta", "preset"] as const;
const KNOWN: readonly string[] = [...REQUIRED, ...OPTIONAL];

type RequiredKey = (typeof REQUIRED)[number];

const REQUIRED_HINTS = {
  walkthrough: `Write \`walkthrough: ${SCHEMA_VERSION}\` — it declares the schema version.`,
  title: 'Write `title: "…"` — it heads the walkthrough.',
  pr: "Write `pr: 96` — the pull-request number the walkthrough describes.",
  commit: "Write `commit: <sha>` — the commit the walkthrough was authored against.",
} satisfies Readonly<Record<RequiredKey, string>>;

const INVALID_FIELDS = [
  {
    key: "walkthrough",
    message: (value: string) => `Unsupported schema version \`${value}\`.`,
    hint: `This build reads schema version ${SCHEMA_VERSION}. Write \`walkthrough: ${SCHEMA_VERSION}\`, or run a newer balade.`,
  },
  {
    key: "title",
    message: () => "`title` must be a string.",
    hint: 'Write `title: "…"`.',
  },
  {
    key: "pr",
    message: () => "`pr` must be the pull-request number.",
    hint: "Write `pr: 96`, without quotes or a `#`.",
  },
  {
    key: "commit",
    message: () => "`commit` must be the stamped commit SHA.",
    hint: "Write the SHA of the PR head you authored against: `commit: 9f3c2ad…`.",
  },
  {
    key: "preset",
    message: () => "`preset` must be a preset name.",
    hint: "Write `preset: odoo`.",
  },
] as const;

/** YAML scalars under `meta` become strings in the resolved contract. */
const MetaScalar = Schema.Union([Schema.String, Schema.Finite, Schema.Boolean]);
const { walkthrough, title, pr, commit } = FrontmatterSchema.fields;
const RequiredFrontmatterInput = Schema.Struct({
  walkthrough,
  title,
  pr,
  commit,
});
const FrontmatterInput = Schema.Struct({
  ...RequiredFrontmatterInput.fields,
  meta: Schema.optionalKey(Schema.Record(Schema.String, MetaScalar)),
  preset: Schema.optionalKey(Schema.String),
});

const decodeInput = Schema.decodeUnknownResult(FrontmatterInput, {
  errors: "all",
  onExcessProperty: "error",
});
const decodeMap = Schema.decodeUnknownResult(Schema.Record(Schema.String, Schema.Unknown));
const decodeRequired = Schema.decodeUnknownResult(RequiredFrontmatterInput);
const decodeFrontmatter = Schema.decodeUnknownSync(FrontmatterSchema, {
  onExcessProperty: "error",
});
const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

export interface FrontmatterResult {
  frontmatter: FrontmatterType | null;
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
    const line = lines[i] ?? "";
    if (line.startsWith(key) && line.slice(key.length).trimStart().startsWith(":")) return i + 2;
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

  const decodedMap = decodeMap(data);
  if (Result.isFailure(decodedMap)) {
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

  const map = decodedMap.success;
  const at = (key: string): number => frontmatterLine(raw, key);
  const invalid = invalidPaths(decodeInput(map));
  const bad = (code: string, key: string, message: string, hint: string): void => {
    diagnostics.push({ code, level: "error", file, line: at(key), message, hint });
  };

  /* Schema owns which paths are invalid; this mapping keeps the CLI's stable
     diagnostic vocabulary, line lookup and one-pass ordering. */
  for (const key of Object.keys(map)) {
    if (!KNOWN.includes(key) && invalid.has(pathKey(key))) {
      bad(
        "frontmatter-key-unknown",
        key,
        `Unknown frontmatter key \`${key}\`.`,
        `Keep domain keys under \`meta\`: meta:\n  ${key}: …`,
      );
    }
  }
  for (const key of REQUIRED) {
    if (map[key] === undefined && invalid.has(pathKey(key))) {
      bad("frontmatter-invalid", key, `The frontmatter misses \`${key}\`.`, REQUIRED_HINTS[key]);
    }
  }

  for (const field of INVALID_FIELDS) {
    const value = map[field.key];
    if (value !== undefined && invalid.has(pathKey(field.key))) {
      bad("frontmatter-invalid", field.key, field.message(String(value)), field.hint);
    }
  }

  const rawMeta = map["meta"];
  const metaMap = rawMeta === undefined ? undefined : decodeMap(rawMeta);
  if (metaMap !== undefined && Result.isFailure(metaMap)) {
    bad(
      "frontmatter-invalid",
      "meta",
      "`meta` must be a map of domain keys.",
      "Write `meta:` then indented `key: value` lines.",
    );
  } else if (metaMap !== undefined) {
    for (const key of Object.keys(metaMap.success)) {
      if (invalid.has(pathKey("meta", key))) {
        bad(
          "frontmatter-invalid",
          "meta",
          `\`meta.${key}\` must be a scalar.`,
          "Meta values render as header chips; keep them short strings.",
        );
      }
    }
  }

  const required = decodeRequired(map);
  if (Result.isFailure(required)) return { frontmatter: null, diagnostics };

  const metaEntries: Array<[string, string]> = [];
  if (metaMap !== undefined && Result.isSuccess(metaMap)) {
    for (const [key, value] of Object.entries(metaMap.success)) {
      if (!invalid.has(pathKey("meta", key))) metaEntries.push([key, String(value)]);
    }
  }
  const meta = Object.fromEntries(metaEntries);

  const preset = map["preset"];
  const presetFacet: PresetFacet = {};
  if (Predicate.isString(preset)) presetFacet.preset = preset;
  return {
    frontmatter: decodeFrontmatter({ ...required.success, meta, ...presetFacet }),
    diagnostics,
  };
}

type PresetFacet = { preset?: string };

/** Schema issue paths flattened into stable string keys for diagnostic mapping. */
function invalidPaths(result: ReturnType<typeof decodeInput>): ReadonlySet<string> {
  if (Result.isSuccess(result)) return new Set();
  const paths = new Set<string>();
  for (const issue of formatIssues(result.failure.issue).issues) {
    const parts = (issue.path ?? []).map((part) =>
      Predicate.isPropertyKey(part) ? part : part.key,
    );
    paths.add(pathKey(...parts));
  }
  return paths;
}

const pathKey = (...parts: ReadonlyArray<PropertyKey>): string =>
  parts.map((part) => String(part)).join("\u0000");
