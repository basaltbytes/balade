/** Compile one agent answer through the walkthrough's canonical Markdoc block pipeline. */

import type { Node } from "@markdoc/markdoc";
import { Predicate, Result, Schema } from "effect";
import type { ResolveContext } from "../contract/context.js";
import type { Block, CheckDiagnostic } from "../contract/types.js";
import { getPreset } from "../preset/registry.js";
import type { Preset } from "../preset/types.js";
import { compileBlocks, type CompileEnv } from "./blocks.js";
import { parseDocument } from "./document.js";

export interface ParsedFragment {
  readonly nodes: readonly Node[];
  readonly references: readonly string[];
  readonly preset: Preset | undefined;
}

export class FragmentInvalid extends Schema.TaggedErrorClass<FragmentInvalid>()("FragmentInvalid", {
  diagnostics: Schema.Array(Schema.String),
}) {}

/**
 * Parse a body inside a synthetic section. This reuses the exact walkthrough
 * grammar and validation hints without teaching a second Markdoc dialect.
 */
export function parseFragment(
  source: string,
  file: string,
  presetName: string | undefined,
): Result.Result<ParsedFragment, FragmentInvalid> {
  const preset = presetName === undefined ? undefined : getPreset(presetName);
  if (presetName !== undefined && preset === undefined) {
    return Result.fail(
      new FragmentInvalid({
        diagnostics: [`The walkthrough preset ${presetName} is unavailable.`],
      }),
    );
  }
  const presetLine = presetName === undefined ? "" : `preset: ${JSON.stringify(presetName)}\n`;
  const wrapped = `---
walkthrough: 1
title: Clarification
pr: 1
commit: abcdef1
${presetLine}---

{% section id="clarification" title="Clarification" %}
${source}
{% /section %}
`;
  const document = parseDocument(wrapped, file);
  const errors = document.diagnostics.filter((diagnostic) => diagnostic.level === "error");
  const section = document.ast.children.find(
    (node) => node.type === "tag" && node.tag === "section",
  );
  if (errors.length > 0 || section === undefined) {
    return Result.fail(new FragmentInvalid({ diagnostics: errors.map(formatDiagnostic) }));
  }
  if (containsStructuralTag(section.children)) {
    return Result.fail(
      new FragmentInvalid({
        diagnostics: ["A clarification answer cannot create walkthrough sections or groups."],
      }),
    );
  }
  return Result.succeed({
    nodes: section.children,
    references: referencedFiles(section.children),
    preset,
  });
}

function containsStructuralTag(nodes: readonly Node[]): boolean {
  for (const node of nodes) {
    if (node.type === "tag" && (node.tag === "section" || node.tag === "group")) return true;
    if (containsStructuralTag(node.children)) return true;
  }
  return false;
}

export function compileFragment(
  parsed: ParsedFragment,
  ctx: ResolveContext,
  file: string,
  sectionId: string,
): Result.Result<readonly Block[], FragmentInvalid> {
  const diagnostics: CheckDiagnostic[] = [];
  const files = new Map(ctx.files.map((entry) => [entry.path, entry]));
  const env: CompileEnv = {
    file,
    ctx,
    preset: parsed.preset,
    fileEntry: (path) => files.get(path),
    report: (diagnostic) => diagnostics.push(diagnostic),
    echo: () => undefined,
    card: (error) => {
      diagnostics.push({
        code: error.code,
        level: "error",
        file,
        message: error.message,
      });
    },
    markReferenced: () => undefined,
    fileRef: () => undefined,
    fileWhy: () => undefined,
  };
  const blocks = compileBlocks(parsed.nodes, env, sectionId);
  const errors = diagnostics.filter((diagnostic) => diagnostic.level === "error");
  return errors.length === 0
    ? Result.succeed(blocks)
    : Result.fail(new FragmentInvalid({ diagnostics: errors.map(formatDiagnostic) }));
}

function referencedFiles(nodes: readonly Node[]): readonly string[] {
  const paths = new Set<string>();
  const visit = (children: readonly Node[]): void => {
    for (const node of children) {
      if (node.type === "tag" && node.tag === "code") {
        const file = node.attributes["file"];
        if (Predicate.isString(file) && file !== "") paths.add(file);
      }
      visit(node.children);
    }
  };
  visit(nodes);
  return [...paths].sort();
}

const formatDiagnostic = (diagnostic: CheckDiagnostic): string =>
  `${diagnostic.code}: ${diagnostic.message}`;
