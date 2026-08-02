/**
 * Parse and schema-validate a walkthrough file. One pass: every schema and
 * frontmatter problem lands in `diagnostics`, each with a code and a fix hint.
 */

import Markdoc from "@markdoc/markdoc";
import type { Node, ValidateError } from "@markdoc/markdoc";
import type { CheckDiagnostic } from "../payload/types.js";
import { getPreset, presetNames } from "../preset/registry.js";
import type { Preset } from "../preset/types.js";
import { MARKDOC_CONFIG } from "../schema/config.js";
import { parseFrontmatter, frontmatterLine, type Frontmatter } from "../schema/frontmatter.js";
import { CORE_TAG_NAMES } from "../schema/tags.js";

/** A document that cleared the frontmatter gate — `compileDocument` takes only this shape. */
export interface ValidDocument {
  ast: Node;
  source: string;
  /** Raw frontmatter text, for `file:line` diagnostics on its keys. */
  raw: string;
  frontmatter: Frontmatter;
  preset: Preset | undefined;
}

export interface ParsedDocument extends Omit<ValidDocument, "frontmatter"> {
  frontmatter: Frontmatter | null;
  diagnostics: CheckDiagnostic[];
}

const HINTS: Record<string, string> = {
  "tag-undefined": `The core catalog is: ${CORE_TAG_NAMES.filter((name) => name !== "table").join(", ")}. Check the spelling.`,
  "tag-selfclosing-has-children": "Close the tag with `/%}` and move the prose out of it.",
  "tag-placement-invalid": "Put the tag on its own line, between blank lines.",
  "attribute-undefined": "Remove the attribute — each tag takes a fixed set.",
  "attribute-missing-required": "Add the attribute; the tag cannot resolve without it.",
  "attribute-type-invalid": "Numbers take no quotes; arrays use `[…]`; maps use `{…}`.",
  "attribute-value-invalid": "Use one of the listed values.",
  "code-range-invalid": "Count the lines again at the stamped commit: 1 <= from <= to.",
  "odoo-comodel-missing": 'Add comodel="…" — a relational field names the model it points at.',
  "child-invalid": "Move the tag under the parent its family expects.",
  "variable-undefined": "The format holds no variables; write the value in place.",
  "function-undefined": "The format holds no functions; write the value in place.",
};

function levelOf(error: ValidateError): "error" | "warning" {
  return error.error.level === "warning" ||
    error.error.level === "info" ||
    error.error.level === "debug"
    ? "warning"
    : "error";
}

export function parseDocument(source: string, file: string): ParsedDocument {
  const ast = Markdoc.parse(source, { file });
  const raw = String(ast.attributes["frontmatter"] ?? "");
  const { frontmatter, diagnostics } = parseFrontmatter(raw, file);

  let preset: Preset | undefined;
  if (frontmatter?.preset !== undefined) {
    preset = getPreset(frontmatter.preset);
    if (preset === undefined) {
      diagnostics.push({
        code: "preset-unknown",
        level: "error",
        file,
        line: frontmatterLine(raw, "preset"),
        message: `Unknown preset \`${frontmatter.preset}\`.`,
        hint: `This build ships: ${presetNames().join(", ")}. Remove the key to stay on the core catalog.`,
      });
    }
  }

  for (const error of Markdoc.validate(ast, MARKDOC_CONFIG)) {
    const line = (error.lines[0] ?? 0) + 1;
    diagnostics.push({
      code: error.error.id,
      level: levelOf(error),
      file,
      line,
      message: error.error.message,
      hint: HINTS[error.error.id] ?? "Match the tag to the schema of the core catalog.",
    });
  }

  return { ast, source, raw, frontmatter, preset, diagnostics };
}
