/**
 * Rich text flattening: Markdoc AST to the six inline kinds and the three
 * `MdNode` kinds. No HTML, no renderer output — a terminal renderer stays
 * possible on the same payload.
 */

import type { Node } from "@markdoc/markdoc";
import type { Inline, MdNode } from "../contract/types.js";

/** Joins neighbouring strings so the payload carries one text run per span. */
function merge(parts: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const part of parts) {
    const last = out[out.length - 1];
    if (typeof part === "string" && typeof last === "string") out[out.length - 1] = last + part;
    else out.push(part);
  }
  return out.filter((part) => part !== "");
}

export function inlineOf(nodes: readonly Node[]): Inline[] {
  const out: Inline[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        out.push(String(node.attributes["content"] ?? ""));
        break;
      case "code":
        out.push({ c: String(node.attributes["content"] ?? "") });
        break;
      case "strong":
        out.push({ b: inlineOf(node.children) });
        break;
      case "em":
        out.push({ i: inlineOf(node.children) });
        break;
      case "softbreak":
      case "hardbreak":
        out.push(" ");
        break;
      default:
        /* inline, link, s, image and any wrapper: keep the text, drop the shell. */
        out.push(...inlineOf(node.children));
    }
  }
  return merge(out);
}

/**
 * All paragraphs of a tag body, one inline array each. A tag Markdoc parsed as
 * inline (child tags on adjacent lines) carries its text directly.
 */
export function paragraphsOf(node: Node): Inline[][] {
  const out: Inline[][] = [];
  let run: Node[] = [];
  const flush = (): void => {
    if (run.length === 0) return;
    const parts = inlineOf(run);
    if (parts.length > 0) out.push(parts);
    run = [];
  };
  const add = (nodes: readonly Node[]): void => {
    const parts = inlineOf(nodes);
    if (parts.length > 0) out.push(parts);
  };

  for (const child of node.children) {
    switch (child.type) {
      case "paragraph":
      case "heading":
      case "inline":
        flush();
        add(child.children);
        break;
      case "list":
        flush();
        for (const item of child.children) add(item.children);
        break;
      case "tag":
        /* Child tags belong to their own family, never to the parent's prose. */
        flush();
        break;
      default:
        run.push(child);
    }
  }
  flush();
  return out;
}

/** A tag body as one inline run — paragraphs joined by a space. */
export function bodyInline(node: Node): Inline[] {
  const paragraphs = paragraphsOf(node);
  const out: Inline[] = [];
  for (const paragraph of paragraphs) {
    if (out.length > 0) out.push(" ");
    out.push(...paragraph);
  }
  return merge(out);
}

export interface MdResult {
  nodes: MdNode[];
  /** Fenced code blocks: the thin-reference model resolves code from git. */
  fences: Node[];
}

/** Markdown flow content between tags. */
export function mdNodesOf(nodes: readonly Node[]): MdResult {
  const out: MdNode[] = [];
  const fences: Node[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "paragraph": {
        const parts = inlineOf(node.children);
        if (parts.length > 0) out.push({ p: parts });
        break;
      }
      case "heading": {
        const parts = inlineOf(node.children);
        const text = plainText(parts);
        if (text !== "") out.push({ h: text });
        break;
      }
      case "list": {
        const items = node.children
          .map((item) => inlineOf(item.children))
          .filter((item) => item.length > 0);
        if (items.length > 0) {
          out.push({
            list: items,
            ...(node.attributes["ordered"] === true ? { ordered: true } : {}),
          });
        }
        break;
      }
      case "fence":
        fences.push(node);
        break;
      case "blockquote": {
        const inner = mdNodesOf(node.children);
        out.push(...inner.nodes);
        fences.push(...inner.fences);
        break;
      }
      default:
        break;
    }
  }
  return { nodes: out, fences };
}

export function plainText(parts: readonly Inline[]): string {
  let out = "";
  for (const part of parts) {
    if (typeof part === "string") out += part;
    else if (Array.isArray(part)) out += plainText(part);
    else if ("c" in part) out += part.c;
    else if ("m" in part) out += part.m;
    else if ("tag" in part) out += part.tag;
    else if ("b" in part) out += plainText(part.b);
    else if ("i" in part) out += plainText(part.i);
  }
  return out;
}
