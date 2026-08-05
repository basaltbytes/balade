/**
 * Preset seam. A preset registers Markdoc tags under a short prefix and
 * expands them to core payload nodes. Presets live in this repo — external
 * plugin loading is ruled out of v1.
 */

import type { Node, Schema } from "@markdoc/markdoc";
import type { Block, FieldRow, Inline } from "../contract/types.js";
import type { ResolveContext } from "../contract/context.js";

/** A diagnostic a macro raises; the compiler fills in file and line. */
export interface MacroDiagnostic {
  code: string;
  level: "error" | "warning";
  message: string;
  hint: string;
}

export interface MacroApi {
  /** Read access to the resolved PR context — the data core `files`/`i18n` use. */
  readonly ctx: ResolveContext;
  /** Flattens a tag body to inline rich text. */
  inline(node: Node): Inline[];
  /** Flattens a tag body to one inline array per paragraph. */
  paragraphs(node: Node): Inline[][];
  report(diagnostic: MacroDiagnostic): void;
}

export interface BlockMacro {
  slot: "block";
  schema: Schema;
  expand(node: Node, api: MacroApi): Block[];
}

export interface FieldMacro {
  slot: "field";
  schema: Schema;
  expand(node: Node, api: MacroApi): FieldRow[];
}

export type PresetTag = BlockMacro | FieldMacro;

export interface Preset {
  name: string;
  /** Tag-name prefix that identifies this preset's tags, e.g. `o-`. */
  prefix: string;
  tags: Record<string, PresetTag>;
  /** Tone chips beside a core `method` signature, derived from its decorator. */
  methodChips(decorator: string | undefined): string[] | undefined;
}
