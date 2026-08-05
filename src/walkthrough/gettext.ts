/**
 * gettext entry counts for the core `i18n` block. Counting compares the
 * msgid/msgstr maps of the two sides, not the diff text: a reflowed `.po`
 * would otherwise inflate every number.
 */

import { fileName } from "../contract/paths.js";

export interface EntryCounts {
  new?: number;
  updated?: number;
  removed?: number;
}

/** Reads a `.po`/`.pot` body into msgid → concatenated msgstr. */
export function parsePo(source: string): Map<string, string> {
  const entries = new Map<string, string>();
  let id: string | null = null;
  let value = "";
  let target: "id" | "str" | null = null;

  const commit = (): void => {
    if (id !== null && id !== "") entries.set(id, value);
    id = null;
    value = "";
    target = null;
  };

  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) {
      if (line === "") commit();
      continue;
    }
    if (line.startsWith("msgid_plural ")) {
      target = "id";
      id = (id ?? "") + unquote(line.slice("msgid_plural ".length));
      continue;
    }
    if (line.startsWith("msgid ")) {
      commit();
      target = "id";
      id = unquote(line.slice("msgid ".length));
      continue;
    }
    if (line.startsWith("msgstr")) {
      target = "str";
      const cut = line.indexOf(" ");
      value += cut === -1 ? "" : unquote(line.slice(cut + 1));
      continue;
    }
    if (line.startsWith('"')) {
      const piece = unquote(line);
      if (target === "id") id = (id ?? "") + piece;
      else if (target === "str") value += piece;
    }
  }
  commit();
  return entries;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"')) return trimmed;
  try {
    const decoded: unknown = JSON.parse(trimmed);
    if (typeof decoded === "string") return decoded;
  } catch {
    /* Preserve the parser's permissive fallback for malformed catalog lines. */
  }
  const end = trimmed.lastIndexOf('"');
  return end <= 0 ? "" : trimmed.slice(1, end);
}

export function countEntries(oldSource: string | null, newSource: string | null): EntryCounts {
  const before = oldSource === null ? new Map<string, string>() : parsePo(oldSource);
  const after = newSource === null ? new Map<string, string>() : parsePo(newSource);
  let added = 0;
  let updated = 0;
  let removed = 0;
  for (const [id, value] of after) {
    const previous = before.get(id);
    if (previous === undefined) added++;
    else if (previous !== value) updated++;
  }
  for (const id of before.keys()) if (!after.has(id)) removed++;

  const counts: EntryCounts = {};
  if (added > 0) counts.new = added;
  if (updated > 0) counts.updated = updated;
  if (removed > 0) counts.removed = removed;
  return counts;
}

/** `fr.po` → `fr`; a `.pot` template carries no language. */
export function poLanguage(path: string): string | null {
  const name = fileName(path);
  if (!name.endsWith(".po")) return null;
  return name.slice(0, -3);
}

export function isGettext(path: string): boolean {
  return path.endsWith(".po") || path.endsWith(".pot");
}
