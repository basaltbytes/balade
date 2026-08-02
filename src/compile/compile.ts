/**
 * Document to payload. The compiler is a pure function of the parsed document
 * and the resolved PR context, so a server can call it once per request.
 *
 * Both modes share this one pass: `check` reads `diagnostics`, `open`
 * reads `payload.errors` — unresolvable references become error cards and the
 * payload still builds.
 */

import type { Node } from "@markdoc/markdoc";
import { Option } from "effect";
import type {
  Block,
  CheckDiagnostic,
  ErrorCard,
  FileEntry,
  FileStatus,
  NavNode,
  Payload,
  RangeEcho,
  Section,
} from "../payload/types.js";
import type { ResolveContext } from "../resolve/context.js";
import { sha256 } from "../resolve/hash.js";
import { fileName } from "../resolve/paths.js";
import { frontmatterLine } from "../schema/frontmatter.js";
import { SECTION_ID } from "../schema/tags.js";
import { attrStrings, compileBlocks, lineOf, short, type CompileEnv } from "./blocks.js";
import type { ValidDocument } from "./document.js";

export interface CompileInput {
  doc: ValidDocument;
  ctx: ResolveContext;
  /** Repo-relative path of the walkthrough file. */
  sourcePath: string;
  /** `--lang` override; otherwise `meta.lang`, otherwise `en`. */
  lang?: "en" | "fr";
}

export interface CompileResult {
  payload: Payload;
  diagnostics: CheckDiagnostic[];
  ranges: RangeEcho[];
}

/** Files whose stamped blobs the pure compiler may inspect. */
export function referencedFiles(doc: ValidDocument): string[] {
  const paths = new Set<string>();
  const walk = (nodes: readonly Node[]): void => {
    for (const node of nodes) {
      if (node.type === "tag" && (node.tag === "section" || node.tag === "code")) {
        const path = node.attributes["file"];
        if (typeof path === "string" && path !== "") paths.add(path);
      }
      walk(node.children);
    }
  };
  walk(doc.ast.children);
  return [...paths].sort();
}

export function compileDocument(input: CompileInput): CompileResult {
  const { doc, ctx, sourcePath } = input;
  const frontmatter = doc.frontmatter;

  const diagnostics: CheckDiagnostic[] = [];
  const ranges: RangeEcho[] = [];
  const errors: ErrorCard[] = [];
  const referenced = new Set<string>();
  const sourceLines = doc.source.split("\n");

  const files = new Map<string, FileEntry>();
  for (const entry of ctx.files) files.set(entry.path, { ...entry });

  const env: CompileEnv = {
    file: sourcePath,
    ctx,
    preset: doc.preset,
    fileEntry: (path) => files.get(path),
    report: (diagnostic) => diagnostics.push(diagnostic),
    echo: (range) => ranges.push(range),
    card: (error) => errors.push(error),
    markReferenced: (path) => referenced.add(path),
    fileRef: (path, sectionId) => {
      const entry = files.get(path);
      if (entry !== undefined && entry.ref === undefined) {
        files.set(path, { ...entry, ref: sectionId });
      }
    },
    fileWhy: (path, why) => {
      const entry = files.get(path);
      if (entry !== undefined) files.set(path, { ...entry, why });
    },
  };

  const sections: Section[] = [];
  const seen = new Map<string, number>();

  const sectionOf = (node: Node): NavNode | null => {
    const id = String(node.attributes["id"] ?? "");
    const title = String(node.attributes["title"] ?? "");
    const line = lineOf(node);

    if (id === "" || !SECTION_ID.test(id)) return null; /* the schema already reported it */
    const first = seen.get(id);
    if (first !== undefined) {
      diagnostics.push({
        code: "section-id-duplicate",
        level: "error",
        file: sourcePath,
        line,
        message: `The section id \`${id}\` is already used on line ${first}.`,
        hint: "Section ids key the review state; give this one its own kebab-case id.",
      });
    }
    seen.set(id, line);
    const duplicate = first !== undefined;

    /* A duplicate still reports — one pass — but it leaves no error card: no
       rendered section would own one, and the app keys cards by section id. */
    const sectionEnv: CompileEnv = duplicate ? { ...env, card: () => {} } : env;

    const filePath = optionalString(node, "file");
    let status: FileStatus = "M";
    if (filePath !== undefined) {
      env.markReferenced(filePath);
      env.fileRef(filePath, id);
      const entry = files.get(filePath);
      if (entry !== undefined) {
        status = entry.status;
      } else if (Option.isNone(ctx.blob(filePath))) {
        diagnostics.push({
          code: "file-unresolvable",
          level: "error",
          file: sourcePath,
          line,
          message: `The section file \`${filePath}\` does not exist at ${short(ctx.pin)}.`,
          hint: "Use a path relative to the repository root, as git spells it.",
        });
        sectionEnv.card({
          code: "file-unresolvable",
          message: `\`${filePath}\` does not exist at ${short(ctx.pin)}.`,
          reference: filePath,
          sectionId: id,
          line,
        });
      } else {
        diagnostics.push({
          code: "file-not-in-pr",
          level: "warning",
          file: sourcePath,
          line,
          message: `The section file \`${filePath}\` is not part of this PR.`,
          hint: "A file-section marks a changed file; use a plain section for context files.",
        });
      }
    }

    const blocks: Block[] = compileBlocks(node.children, sectionEnv, id);
    const start = node.lines[0] ?? 0;
    const end = node.lines[node.lines.length - 1] ?? start;
    const icon = optionalString(node, "icon");
    const badge = optionalString(node, "badge");
    const badgeTone = optionalString(node, "badgeTone");
    const relatedFiles = attrStrings(node, "relatedFiles");

    if (duplicate) return null;

    sections.push({
      id,
      title,
      hash: sha256(sourceLines.slice(start, end + 1).join("\n")),
      blocks,
      ...(icon !== undefined ? { icon } : {}),
      ...(badge !== undefined
        ? { badge: { label: badge, tone: toneOf(badgeTone, status, filePath !== undefined) } }
        : {}),
      ...(filePath !== undefined ? { file: filePath } : {}),
      ...(relatedFiles.length > 0 ? { relatedFiles } : {}),
    });

    const label =
      optionalString(node, "nav") ?? (filePath !== undefined ? fileName(filePath) : title);
    if (filePath !== undefined) return { kind: "file", label, ref: id, status };
    return { kind: "section", label, ref: id, ...(icon !== undefined ? { icon } : {}) };
  };

  const walk = (nodes: readonly Node[]): NavNode[] => {
    const nav: NavNode[] = [];
    for (const node of nodes) {
      if (node.type === "tag" && node.tag === "group") {
        nav.push({
          kind: "group",
          label: String(node.attributes["label"] ?? ""),
          children: walk(node.children),
        });
        continue;
      }
      if (node.type === "tag" && node.tag === "section") {
        const entry = sectionOf(node);
        if (entry !== null) nav.push(entry);
        continue;
      }
      if (node.type === "tag") {
        diagnostics.push({
          code: "tag-outside-section",
          level: "error",
          file: sourcePath,
          line: lineOf(node),
          message: `The tag \`${node.tag ?? ""}\` sits outside a section.`,
          hint: "The document body holds sections and groups only; move the tag inside a `section`.",
        });
        continue;
      }
      if (hasContent(node)) {
        diagnostics.push({
          code: "content-outside-section",
          level: "warning",
          file: sourcePath,
          line: lineOf(node),
          message: "Prose outside a section does not reach the payload.",
          hint: "Move it into a `section`; the document body holds sections and groups only.",
        });
      }
    }
    return nav;
  };

  const nav = walk(doc.ast.children);

  if (ctx.headDistance > 0) {
    const overlap = [...referenced].filter((path) => ctx.touched.has(path)).sort();
    const line = frontmatterLine(doc.raw, "commit");
    if (overlap.length > 0) {
      diagnostics.push({
        code: "stale-overlap",
        level: "error",
        file: sourcePath,
        line,
        message: `The PR head moved ${ctx.headDistance} commit${ctx.headDistance === 1 ? "" : "s"} past the stamp, and it touches ${overlap.join(", ")}.`,
        hint: `Re-read the changed files, update the ranges, then re-stamp: commit: ${short(ctx.headSha)}.`,
      });
    } else {
      diagnostics.push({
        code: "stale",
        level: "warning",
        file: sourcePath,
        line,
        message: `The PR head moved ${ctx.headDistance} commit${ctx.headDistance === 1 ? "" : "s"} past the stamp, but touches no file this walkthrough shows.`,
        hint: `Re-stamp when convenient: commit: ${short(ctx.headSha)}.`,
      });
    }
  }

  const lang = input.lang ?? langOfMeta(frontmatter.meta["lang"]);
  const payload: Payload = {
    walkthrough: 1,
    title: frontmatter.title,
    commit: ctx.pin,
    headDistance: ctx.headDistance,
    lang,
    meta: frontmatter.meta,
    pr: ctx.pr,
    files: [...files.values()],
    nav,
    sections,
    errors,
    sourcePath,
    storageKey: `balade:${ctx.repoSlug}#${frontmatter.pr}:${sourcePath}`,
    ...(doc.preset !== undefined ? { preset: doc.preset.name } : {}),
  };

  return { payload, diagnostics, ranges };
}

function optionalString(node: Node, name: string): string | undefined {
  const value = node.attributes[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function toneOf(
  declared: string | undefined,
  status: FileStatus,
  isFile: boolean,
): "new" | "mod" | "del" {
  if (declared === "new" || declared === "mod" || declared === "del") return declared;
  if (!isFile) return "mod";
  if (status === "A") return "new";
  if (status === "D") return "del";
  return "mod";
}

function langOfMeta(value: string | undefined): "en" | "fr" {
  return value === "fr" ? "fr" : "en";
}

function hasContent(node: Node): boolean {
  if (node.type === "text") return String(node.attributes["content"] ?? "").trim() !== "";
  if (
    node.type === "paragraph" ||
    node.type === "heading" ||
    node.type === "list" ||
    node.type === "fence" ||
    node.type === "table"
  )
    return true;
  return node.children.some(hasContent);
}
