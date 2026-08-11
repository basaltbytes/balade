/* Review state, as pure functions over the payload and the stored marks.
   Nothing here touches the network, storage, or the DOM. */

import type { FileEntry, Payload, ReviewMark, ReviewState, Section } from "../contract";

export interface Progress {
  done: number;
  total: number;
}

/** What the hash rule dropped, for the reset banner. */
export interface ResetReport {
  sections: string[];
  files: string[];
}

export interface Reconciled {
  state: ReviewState;
  reset: ResetReport;
  /** True when reconciling produced something different from what was stored. */
  changed: boolean;
}

/** File marks are section-scoped: the same path in two browsers stays independent. */
export const fileKey = (sectionId: string, path: string): string => `${sectionId}//${path}`;

export const emptyState = (payload: Payload): ReviewState => ({
  version: 1,
  walkthrough: payload.sourcePath,
  pr: payload.pr.number,
  stamp: payload.commit,
  sections: {},
  files: {},
});

/* Computed once per payload: components call these on every render. */
const sectionIndex = new WeakMap<Payload, Map<string, Section>>();
const fileIndex = new WeakMap<Payload, Map<string, FileEntry>>();

export function sectionById(payload: Payload): Map<string, Section> {
  let map = sectionIndex.get(payload);
  if (map === undefined) {
    map = new Map(payload.sections.map((s) => [s.id, s]));
    sectionIndex.set(payload, map);
  }
  return map;
}

export function fileByPath(payload: Payload): Map<string, FileEntry> {
  let map = fileIndex.get(payload);
  if (map === undefined) {
    map = new Map(payload.files.map((f) => [f.path, f]));
    fileIndex.set(payload, map);
  }
  return map;
}

/**
 * Selective, hash-based reset: a mark survives only while the content hash it
 * was made against still matches the payload. Marks whose section or file is
 * gone disappear without a word; hash mismatches are reported so the banner can
 * name them.
 */
export function reconcile(payload: Payload, stored: ReviewState | null): Reconciled {
  const base = emptyState(payload);
  const reset: ResetReport = { sections: [], files: [] };
  if (stored === null) return { state: base, reset, changed: false };

  const sections = sectionById(payload);
  const files = fileByPath(payload);
  const keptSections: Record<string, ReviewMark> = {};
  const keptFiles: Record<string, ReviewMark> = {};

  for (const [id, mark] of Object.entries(stored.sections)) {
    const section = sections.get(id);
    if (!section) continue;
    if (section.hash === mark.hash) keptSections[id] = mark;
    else reset.sections.push(section.title);
  }

  for (const [key, mark] of Object.entries(stored.files)) {
    const split = key.indexOf("//");
    if (split < 0) continue;
    const sectionId = key.slice(0, split);
    const path = key.slice(split + 2);
    if (!sections.has(sectionId)) continue;
    const entry = files.get(path);
    if (!entry) continue;
    if (entry.hash === mark.hash) keptFiles[key] = mark;
    else reset.files.push(path);
  }

  const state: ReviewState = { ...base, sections: keptSections, files: keptFiles };

  const changed =
    reset.sections.length > 0 ||
    reset.files.length > 0 ||
    stored.stamp !== state.stamp ||
    stored.walkthrough !== state.walkthrough ||
    stored.pr !== state.pr;

  return { state, reset, changed };
}

export const isSectionReviewed = (state: ReviewState, sectionId: string): boolean =>
  state.sections[sectionId] !== undefined;

export const isFileViewed = (state: ReviewState, sectionId: string, path: string): boolean =>
  state.files[fileKey(sectionId, path)] !== undefined;

/** Progress counts sections; a section is done only through its own explicit mark. */
export function sectionProgress(payload: Payload, state: ReviewState): Progress {
  let done = 0;
  for (const section of payload.sections) if (isSectionReviewed(state, section.id)) done += 1;
  return { done, total: payload.sections.length };
}

/** Paths of every `files` browser a section carries, in render order. */
function browserPaths(section: Section): string[] {
  const paths: string[] = [];
  for (const block of section.blocks) {
    if (block.b !== "files") continue;
    for (const group of block.groups ?? []) for (const path of group.paths) paths.push(path);
    for (const path of block.paths) paths.push(path);
  }
  return paths;
}

/** "n/m files" beside a section — information only, never a section's own mark. */
export function fileProgress(
  payload: Payload,
  state: ReviewState,
  section: Section,
): Progress | null {
  const known = fileByPath(payload);
  const paths = browserPaths(section).filter((p) => known.has(p));
  if (paths.length === 0) return null;
  let done = 0;
  for (const path of paths) if (isFileViewed(state, section.id, path)) done += 1;
  return { done, total: paths.length };
}

export const isComplete = (payload: Payload, state: ReviewState): boolean =>
  payload.sections.length > 0 && sectionProgress(payload, state).done === payload.sections.length;

/**
 * The next section to review, starting after `afterId` and wrapping around, so
 * the jump keeps working from anywhere in the document.
 */
export function nextUnreviewed(
  payload: Payload,
  state: ReviewState,
  afterId?: string,
): string | null {
  const ids = payload.sections.map((s) => s.id);
  const start = afterId ? ids.indexOf(afterId) + 1 : 0;
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[(start + i) % ids.length];
    if (id !== undefined && !isSectionReviewed(state, id)) return id;
  }
  return null;
}

const withoutKey = <T>(record: Record<string, T>, key: string): Record<string, T> => {
  const next = { ...record };
  delete next[key];
  return next;
};

export function toggleSection(
  payload: Payload,
  state: ReviewState,
  sectionId: string,
  at: string,
): ReviewState {
  if (isSectionReviewed(state, sectionId)) {
    return { ...state, sections: withoutKey(state.sections, sectionId) };
  }
  const section = sectionById(payload).get(sectionId);
  if (!section) return state;
  return { ...state, sections: { ...state.sections, [sectionId]: { hash: section.hash, at } } };
}

export function toggleFile(
  payload: Payload,
  state: ReviewState,
  sectionId: string,
  path: string,
  at: string,
): ReviewState {
  const key = fileKey(sectionId, path);
  if (state.files[key] !== undefined) {
    return { ...state, files: withoutKey(state.files, key) };
  }
  const entry = fileByPath(payload).get(path);
  if (!entry) return state;
  return { ...state, files: { ...state.files, [key]: { hash: entry.hash, at } } };
}
