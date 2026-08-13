/**
 * The prose seam: prompt and skill prose lives in Markdown files beside the
 * modules that render them, so editing a prompt is editing a document, not a
 * template literal. `{{name}}` placeholders carry the typed values in, and
 * substitution is strict both ways: a placeholder without a slot, a slot
 * without a placeholder, and a malformed placeholder each fail the first
 * render instead of shipping a hole in a prompt. The build mirrors every
 * `src/**` Markdown file into `dist/` (`scripts/copy-prose.mjs`), so
 * `proseTemplate` resolves identically from sources under vitest and from
 * the published package.
 */

import { readFileSync } from "node:fs";

/** Reads the Markdown prose document shipped beside the calling module. */
export function proseTemplate(moduleUrl: string, name: string): string {
  return readFileSync(new URL(name, moduleUrl), "utf8");
}

/** Slot text by placeholder name; names are lower-kebab. */
export type ProseSlots = Readonly<Record<string, string>>;

/** Substitutes every `{{name}}` placeholder in `template` with its slot text. */
export function renderProse(template: string, slots: ProseSlots): string {
  const used = new Set<string>();
  let substitutions = 0;
  const rendered = template.replace(/\{\{([a-z0-9-]+)\}\}/g, (placeholder, name: string) => {
    const text = slots[name];
    if (text === undefined) throw new Error(`prose placeholder ${placeholder} has no slot`);
    used.add(name);
    substitutions += 1;
    return text;
  });
  const opens = template.match(/\{\{/g)?.length ?? 0;
  if (opens !== substitutions) {
    throw new Error(`prose template holds ${opens - substitutions} malformed {{…}} placeholder(s)`);
  }
  for (const name of Object.keys(slots)) {
    if (!used.has(name)) throw new Error(`prose slot ${name} has no {{${name}}} placeholder`);
  }
  return rendered;
}

/**
 * Renders `## ` Markdown headings as bare title lines for a plain-text
 * prompt host. Callers apply it to the template before substitution, so slot
 * text is never rewritten. The transform is not fence-aware: in a document
 * rendered plain, a line starting with `## ` is always a section heading,
 * even inside a fenced example.
 */
export function plainHeadings(markdown: string): string {
  return markdown.replace(/^## /gm, "");
}
