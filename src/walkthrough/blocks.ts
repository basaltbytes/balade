/**
 * Tag bodies to payload blocks. Everything here is a pure function of the AST
 * plus the resolved PR context; git access happens through `ResolveContext`.
 */

import type { Node } from "@markdoc/markdoc";
import { Option } from "effect";
import type {
  Block,
  CardItem,
  CheckDiagnostic,
  CodeBlock,
  ErrorCard,
  FieldRow,
  I18nRow,
  Inline,
  PatternItem,
  RangeEcho,
  TestItem,
} from "../contract/types.js";
import type { MacroApi, Preset } from "../preset/types.js";
import { presetOfTag } from "../preset/registry.js";
import type { ResolveContext } from "../contract/context.js";
import { countEntries, isGettext, poLanguage } from "./gettext.js";
import { matchesGlob } from "./glob.js";
import { langOf } from "../contract/lang.js";
import { CHILD_TAGS, FILE_STATUSES, statusList } from "./tags.js";
import { diagramBlock } from "../contract/diagram.js";
import { bodyInline, inlineOf, mdNodesOf, paragraphsOf, plainText } from "./inline.js";

export interface CompileEnv {
  /** Repo-relative path of the walkthrough file. */
  readonly file: string;
  readonly ctx: ResolveContext;
  readonly preset: Preset | undefined;
  /** The PR's entry for a path, from the map the compiler already keeps. */
  fileEntry(path: string): { lang?: string } | undefined;
  report(diagnostic: CheckDiagnostic): void;
  echo(range: RangeEcho): void;
  card(error: ErrorCard): void;
  /** Records a path a block resolves, for the staleness overlap rule. */
  markReferenced(path: string): void;
  /** Links a changed file to the section that presents it. */
  fileRef(path: string, sectionId: string): void;
  fileWhy(path: string, why: Inline): void;
}

export function lineOf(node: Node): number {
  return (node.lines[0] ?? 0) + 1;
}

function attrString(node: Node, name: string): string | undefined {
  const value = node.attributes[name];
  return typeof value === "string" ? value : undefined;
}

export function attrStrings(node: Node, name: string): string[] {
  const value = node.attributes[name];
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

/** `mark="12-14,20"` or `mark=[12, 13]` — absolute line numbers to highlight. */
export function parseMark(value: unknown): number[] {
  const out: number[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      const n = Number(item);
      if (Number.isInteger(n)) out.push(n);
    }
    return out;
  }
  if (typeof value !== "string") return out;
  for (const part of value.split(",")) {
    const piece = part.trim();
    if (piece === "") continue;
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(piece);
    if (range !== null) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      for (let n = from; n <= to; n++) out.push(n);
      continue;
    }
    const single = Number(piece);
    if (Number.isInteger(single)) out.push(single);
  }
  return out;
}

/** Markdown flow between tags collapses into `md` blocks. */
export function compileBlocks(
  children: readonly Node[],
  env: CompileEnv,
  sectionId: string,
): Block[] {
  const blocks: Block[] = [];
  let flow: Node[] = [];

  const flushFlow = (): void => {
    if (flow.length === 0) return;
    const { nodes, fences } = mdNodesOf(flow);
    for (const fence of fences) {
      env.report({
        code: "fence-unsupported",
        level: "warning",
        file: env.file,
        line: lineOf(fence),
        message: "A fenced code block does not reach the payload.",
        hint: 'Reference the code in git instead: {% code file="…" from=1 to=10 expect="…" /%}.',
      });
    }
    if (nodes.length > 0) blocks.push({ b: "md", nodes });
    flow = [];
  };

  for (const child of children) {
    if (child.type !== "tag" && child.type !== "table") {
      flow.push(child);
      continue;
    }
    if (child.type === "table") {
      flushFlow();
      blocks.push(tableBlock(child));
      continue;
    }
    flushFlow();
    blocks.push(...compileTag(child, env, sectionId));
  }
  flushFlow();
  return blocks;
}

/** Reports a preset tag in a file that does not activate its preset; true when it may expand. */
function presetActive(node: Node, owner: Preset, env: CompileEnv, fallback: string): boolean {
  if (env.preset?.name === owner.name) return true;
  env.report({
    code: "preset-tag-inactive",
    level: "error",
    file: env.file,
    line: lineOf(node),
    message: `The tag \`${node.tag ?? ""}\` belongs to the \`${owner.name}\` preset, which this file does not activate.`,
    hint: `Add \`preset: ${owner.name}\` to the frontmatter, or use ${fallback} instead.`,
  });
  return false;
}

function compileTag(node: Node, env: CompileEnv, sectionId: string): Block[] {
  const tag = node.tag ?? "";

  const owner = presetOfTag(tag);
  if (owner !== undefined) {
    if (!presetActive(node, owner, env, "the core tag")) return [];
    const macro = owner.tags[tag];
    if (macro !== undefined && macro.slot === "block") {
      return macro.expand(node, macroApi(env, node));
    }
    env.report({
      code: "preset-tag-misplaced",
      level: "error",
      file: env.file,
      line: lineOf(node),
      message: `The tag \`${tag}\` cannot stand on its own.`,
      hint: `Put it inside its parent tag, as \`field\` goes inside \`fields\`.`,
    });
    return [];
  }

  switch (tag) {
    case "callout": {
      const tone = attrString(node, "tone");
      return [
        {
          b: "callout",
          body: bodyInline(node),
          ...(tone === "key" || tone === "warn" ? { tone } : {}),
        },
      ];
    }
    case "flow":
      return [{ b: "flow", steps: childTags(node, "flow", env).map(stepItem) }];
    case "fields":
      return [{ b: "fields", rows: fieldRows(node, env) }];
    case "method": {
      const decorator = attrString(node, "decorator");
      const declared = attrStrings(node, "chips");
      const chips = declared.length > 0 ? declared : env.preset?.methodChips(decorator);
      return [
        {
          b: "method",
          sig: attrString(node, "sig") ?? "",
          body: bodyInline(node),
          ...(decorator !== undefined ? { decorator } : {}),
          ...(chips !== undefined && chips.length > 0 ? { chips } : {}),
        },
      ];
    }
    case "tests":
      return [{ b: "tests", items: childTags(node, "tests", env).map(testItem) }];
    case "matrix":
      return [matrixBlock(node, env)];
    case "table":
      return [tableBlock(tableSource(node) ?? node)];
    case "cards": {
      const cols = node.attributes["cols"];
      return [
        {
          b: "cards",
          cols: cols === 1 || cols === 3 ? cols : 2,
          items: childTags(node, "cards", env).map(cardItem),
        },
      ];
    }
    case "patterns":
      return [{ b: "patterns", items: childTags(node, "patterns", env).map(patternItem) }];
    case "attrs":
      return [{ b: "attrs", items: attrStrings(node, "items") }];
    case "diagram":
      return [diagramBlock(node)];
    case "files":
      return [filesBlock(node, env, sectionId)];
    case "i18n":
      return [i18nBlock(env, sectionId)];
    case "code":
      return codeBlock(node, env, sectionId);
    default:
      /* An unknown tag already produced a Markdoc `tag-undefined` error. */
      return [];
  }
}

function macroApi(env: CompileEnv, node: Node): MacroApi {
  return {
    ctx: env.ctx,
    inline: bodyInline,
    paragraphs: paragraphsOf,
    report: (diagnostic) => {
      env.report({ ...diagnostic, file: env.file, line: lineOf(node) });
    },
  };
}

/**
 * Direct tag children, looking through the paragraph wrapper Markdoc adds when
 * child tags sit on adjacent lines.
 */
function tagChildren(node: Node): Node[] {
  const out: Node[] = [];
  for (const child of node.children) {
    if (child.type === "tag") out.push(child);
    else if (child.type === "paragraph" || child.type === "inline") out.push(...tagChildren(child));
  }
  return out;
}

/** Child tags of a family, with a diagnostic for anything unexpected. */
function childTags(node: Node, family: string, env: CompileEnv): Node[] {
  const allowed = CHILD_TAGS[family] ?? [];
  const out: Node[] = [];
  for (const child of tagChildren(node)) {
    if (child.type !== "tag") continue;
    const tag = child.tag ?? "";
    const owner = presetOfTag(tag);
    if (allowed.includes(tag) || (owner !== undefined && owner.tags[tag]?.slot === "field")) {
      out.push(child);
      continue;
    }
    env.report({
      code: "child-invalid",
      level: "error",
      file: env.file,
      line: lineOf(child),
      message: `\`${family}\` cannot hold a \`${tag}\` tag.`,
      hint: `Use ${allowed.map((name) => `\`${name}\``).join(" or ")} inside \`${family}\`.`,
    });
  }
  return out;
}

function stepItem(node: Node): { body: Inline[]; tag?: string } {
  const tag = attrString(node, "tag");
  return { body: bodyInline(node), ...(tag !== undefined ? { tag } : {}) };
}

function fieldRows(node: Node, env: CompileEnv): FieldRow[] {
  const rows: FieldRow[] = [];
  for (const child of childTags(node, "fields", env)) {
    const tag = child.tag ?? "";
    const owner = presetOfTag(tag);
    if (owner !== undefined) {
      if (!presetActive(child, owner, env, "`field`")) continue;
      const macro = owner.tags[tag];
      if (macro !== undefined && macro.slot === "field") {
        rows.push(...macro.expand(child, macroApi(env, child)));
      }
      continue;
    }
    const badges = attrStrings(child, "badges");
    const tags = attrStrings(child, "tags");
    rows.push({
      name: attrString(child, "name") ?? "",
      kind: attrString(child, "kind") ?? "",
      note: bodyInline(child),
      ...(badges.length > 0 ? { badges } : {}),
      ...(tags.length > 0 ? { tags } : {}),
    });
  }
  return rows;
}

function testItem(node: Node): TestItem {
  const kind = attrString(node, "kind");
  const ref = attrString(node, "ref");
  return {
    name: attrString(node, "name") ?? "",
    kind: kind === "tour" || kind === "http" ? kind : "unit",
    scenario: bodyInline(node),
    asserts: attrStrings(node, "asserts").map((text) => [text]),
    ...(ref !== undefined ? { ref } : {}),
  };
}

function cardItem(node: Node): CardItem {
  const icon = attrString(node, "icon");
  const title = attrString(node, "title");
  return {
    body: paragraphsOf(node),
    ...(icon !== undefined ? { icon } : {}),
    ...(title !== undefined ? { title } : {}),
  };
}

function patternItem(node: Node): PatternItem {
  const icon = attrString(node, "icon");
  const ref = attrString(node, "ref");
  return {
    term: attrString(node, "term") ?? "",
    body: bodyInline(node),
    ...(icon !== undefined ? { icon } : {}),
    ...(ref !== undefined ? { ref } : {}),
  };
}

function innerTable(node: Node): Node | undefined {
  return node.children.find((child) => child.type === "table");
}

/** The markdown table beneath a tag, unwrapping one `{% table %}` wrapper when present. */
function tableSource(node: Node): Node | undefined {
  const direct = innerTable(node);
  if (direct !== undefined) return direct;
  const wrapper = node.children.find(
    (child) => child.tag === "table" && innerTable(child) !== undefined,
  );
  return wrapper === undefined ? undefined : innerTable(wrapper);
}

interface TableData {
  head: Inline[][];
  rows: Inline[][][];
}

function tableData(node: Node): TableData {
  const head: Inline[][] = [];
  const rows: Inline[][][] = [];
  for (const part of node.children) {
    const isHead = part.type === "thead";
    for (const row of part.children) {
      if (row.type !== "tr") continue;
      const cells = row.children
        .filter((cell) => cell.type === "td" || cell.type === "th")
        .map((cell) => inlineOf(cell.children));
      if (isHead && head.length === 0) head.push(...cells);
      else rows.push(cells);
    }
  }
  /* `{% table %}` puts its header row in the body when the tokenizer cannot tell. */
  if (head.length === 0 && rows.length > 0) {
    const first = rows.shift();
    if (first !== undefined) head.push(...first);
  }
  return { head, rows };
}

function tableBlock(node: Node): Block {
  const { head, rows } = tableData(node);
  const firstColMono = rows.every((row) => {
    const cell = row[0];
    return (
      cell !== undefined &&
      cell.length === 1 &&
      typeof cell[0] === "object" &&
      cell[0] !== null &&
      "c" in cell[0]
    );
  });
  return {
    b: "table",
    head,
    rows,
    ...(rows.length > 0 && firstColMono ? { firstColMono: true } : {}),
  };
}

const TRUE_CELLS = ["✓", "✔", "x", "X", "yes", "true", "✅"];

function matrixBlock(node: Node, env: CompileEnv): Block {
  const source = tableSource(node);
  if (source === undefined) {
    env.report({
      code: "matrix-empty",
      level: "error",
      file: env.file,
      line: lineOf(node),
      message: "`matrix` holds no table.",
      hint: "Put a markdown table inside `matrix` — the first column is the row label.",
    });
    return { b: "matrix", head: [], rows: [] };
  }
  const { head, rows } = tableData(source);
  return {
    b: "matrix",
    head: head.map((cell) => plainText(cell)),
    rows: rows.map((row) => ({
      label: plainText(row[0] ?? []),
      cells: row.slice(1).map((cell) => TRUE_CELLS.includes(plainText(cell).trim())),
    })),
  };
}

function filesBlock(node: Node, env: CompileEnv, sectionId: string): Block {
  const only = attrString(node, "only");
  const status = attrString(node, "status");
  const wanted = status === undefined ? null : new Set(statusList(status));
  const why = node.attributes["why"];
  const whyMap = typeof why === "object" && why !== null && !Array.isArray(why) ? why : {};

  const paths = env.ctx.files
    .filter((entry) => (only === undefined ? true : matchesGlob(entry.path, only)))
    .filter((entry) => (wanted === null ? true : wanted.has(entry.status)))
    .map((entry) => entry.path);
  const held = new Set(paths);

  for (const path of paths) env.fileRef(path, sectionId);

  for (const [path, text] of Object.entries(whyMap)) {
    if (!held.has(path)) {
      env.report({
        code: "file-unresolvable",
        level: "error",
        file: env.file,
        line: lineOf(node),
        message: `\`why\` names \`${path}\`, which this file list does not hold.`,
        hint: "Name a path the PR changed, and keep it inside the `only`/`status` filter.",
      });
      continue;
    }
    env.fileWhy(path, String(text));
  }

  if (paths.length === 0) {
    env.report({
      code: "files-empty",
      level: "warning",
      file: env.file,
      line: lineOf(node),
      message: "The `files` filter matches nothing in this PR.",
      hint: `Check the filter: ${only === undefined ? "no glob" : `only="${only}"`}${status === undefined ? "" : `, status="${status}"`}. Statuses are ${FILE_STATUSES.join(", ")}.`,
    });
  }
  return { b: "files", paths };
}

function i18nBlock(env: CompileEnv, sectionId: string): Block {
  const rows: I18nRow[] = [];
  for (const entry of env.ctx.files) {
    if (!isGettext(entry.path)) continue;
    env.fileRef(entry.path, sectionId);
    const lang = poLanguage(entry.path);
    rows.push({
      path: entry.path,
      status: entry.status,
      additions: entry.additions,
      deletions: entry.deletions,
      entries: countEntries(entry.diff?.oldContent ?? null, entry.diff?.newContent ?? null),
      ...(lang !== null ? { lang } : {}),
    });
  }
  return { b: "i18n", rows };
}

function codeBlock(node: Node, env: CompileEnv, sectionId: string): Block[] {
  const file = attrString(node, "file") ?? "";
  const from = Number(node.attributes["from"]);
  const to = Number(node.attributes["to"]);
  const reference = `${file}:${from}-${to}`;
  const line = lineOf(node);
  env.markReferenced(file);

  const blob = env.ctx.blob(file);
  if (Option.isNone(blob)) {
    env.report({
      code: "file-unresolvable",
      level: "error",
      file: env.file,
      line,
      message: `\`${file}\` does not exist at the stamped commit ${short(env.ctx.pin)}.`,
      hint: "Check the path — it is relative to the repository root — or re-stamp the walkthrough against a commit that holds the file.",
    });
    env.card({
      code: "file-unresolvable",
      message: `\`${file}\` does not exist at ${short(env.ctx.pin)}.`,
      reference,
      sectionId,
      line,
    });
    return [];
  }

  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 1 ||
    to < from ||
    to > blob.value.length
  ) {
    env.report({
      code: "range-unresolvable",
      level: "error",
      file: env.file,
      line,
      message: `Lines ${from}-${to} fall outside \`${file}\`, which holds ${blob.value.length} lines at ${short(env.ctx.pin)}.`,
      hint: `Use a range inside 1-${blob.value.length}.`,
    });
    env.card({
      code: "range-unresolvable",
      message: `Lines ${from}-${to} fall outside \`${file}\` (${blob.value.length} lines).`,
      reference,
      sectionId,
      line,
    });
    return [];
  }

  env.fileRef(file, sectionId);

  const lines = blob.value.slice(from - 1, to);
  const first = lines[0] ?? "";
  const last = lines[lines.length - 1] ?? "";
  env.echo({ file, from, to, firstLine: first, lastLine: last, atLine: line });

  const changedAll = env.ctx.changed.get(file);
  const changed: number[] = [];
  if (changedAll !== undefined) {
    for (let n = from; n <= to; n++) if (changedAll.has(n)) changed.push(n);
  }

  const mark = parseMark(node.attributes["mark"]);
  const outside = mark.filter((n) => n < from || n > to);
  if (outside.length > 0) {
    env.report({
      code: "mark-outside-range",
      level: "warning",
      file: env.file,
      line,
      message: `\`mark\` names ${outside.join(", ")}, outside the range ${from}-${to}.`,
      hint: `Mark lines are absolute file line numbers; keep them inside ${from}-${to}.`,
    });
  }

  const view = attrString(node, "view");
  const collapsed = node.attributes["collapsed"] === true;
  const expected = attrString(node, "expect");
  let expect: CodeBlock["expect"];
  if (expected === undefined) {
    env.report({
      code: "expect-missing",
      level: "warning",
      file: env.file,
      line,
      message: `The code reference \`${reference}\` carries no \`expect\`.`,
      hint: `Add expect="${quoteFragment(first)}" — a literal fragment of line ${from}, so a miscounted range fails loudly.`,
    });
  } else if (first.includes(expected)) {
    expect = { value: expected, status: "ok" };
  } else {
    expect = { value: expected, status: "mismatch" };
    env.report({
      code: "expect-mismatch",
      level: "error",
      file: env.file,
      line,
      message: `Line ${from} of \`${file}\` does not hold the expected fragment.`,
      hint: "Recount the range, then quote a fragment of its first line.",
      expected,
      actual: first,
    });
  }

  const block: CodeBlock = {
    b: "code",
    file,
    from,
    to,
    lang: env.fileEntry(file)?.lang ?? langOf(file),
    view: view === "plain" || view === "diff" ? view : "change",
    ...(collapsed ? { collapsed } : {}),
    lines: [...lines],
    changed,
    ...(mark.length > 0 ? { mark } : {}),
    ...(expect !== undefined ? { expect } : {}),
  };
  return [block];
}

export function short(sha: string): string {
  return sha.slice(0, 7);
}

/** A safe `expect=` suggestion: the first words of the line, without quotes. */
function quoteFragment(line: string): string {
  const trimmed = line.trim().replace(/"/g, "");
  return trimmed.length <= 40 ? trimmed : trimmed.slice(0, 40).trimEnd();
}
