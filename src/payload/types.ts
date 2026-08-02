/**
 * The resolved-payload contract.
 *
 * This is the single data shape the CLI produces and every renderer consumes
 * (the React SPA today, a terminal renderer tomorrow). The rules, locked by
 * the wayfinder map (basaltbytes/skills#1):
 *
 * - No HTML, JSX, or renderer output anywhere. Rich text is inline nodes.
 * - Code ships as raw lines plus change data; highlighting happens in the
 *   renderer (shiki `github-dark-default`).
 * - Icons are octicon names, never markup.
 * - Nav is plain data — a nested tree.
 * - A preset may add namespaced node kinds (`odoo/...`). A consumer without
 *   that renderer shows a labeled placeholder.
 *
 * Spec tickets: input schema #11, primitive catalog #12, pr-96 prototype
 * amendments #13, review-state model #14, CLI architecture #15, theming #16,
 * Odoo preset #17, expect= tripwire #24, multi-walkthrough index #21.
 */

/* ------------------------------------------------------------------ */
/* Inline rich text — the six kinds the pr-96 prototype proved out     */
/* ------------------------------------------------------------------ */

export type Inline =
  | string /* plain text */
  | Inline[]
  | { c: string } /* inline code */
  | { b: Inline[] } /* bold */
  | { i: Inline[] } /* italic */
  | { m: string } /* mono accent (accent-muted) */
  | { tag: string }; /* small mono chip */

/* ------------------------------------------------------------------ */
/* Markdown flow content inside tag bodies and `md` blocks             */
/* ------------------------------------------------------------------ */

export type MdNode =
  | { p: Inline[] } /* paragraph */
  | { h: string } /* `###` heading (one level in v1) */
  | { list: Inline[][]; ordered?: boolean };

/* ------------------------------------------------------------------ */
/* Diff and code data                                                  */
/* ------------------------------------------------------------------ */

export type FileStatus = "A" | "M" | "D" | "R";

/** One changed file of the PR, CLI-computed at the pinned commit. */
export interface FileEntry {
  path: string;
  /** Present when status is "R". */
  oldPath?: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  /** Section id this file links to in nav and file rows. */
  ref?: string;
  /** Author-supplied one-line rationale (mostly for deleted files). */
  why?: Inline;
  /** sha256 of the file's diff text — the review-state reset key (#14). */
  hash: string;
  /** Highlight language id for the renderer, e.g. "python", "xml". */
  lang: string;
  /**
   * Diff data for the per-file browser (#13: `files` is a GitHub-style
   * diff browser). `null` for binary files.
   */
  diff: FileDiff | null;
}

export interface FileDiff {
  /** Raw unified diff body for this file (hunk headers included). */
  unified: string;
  /**
   * Full file contents at the diff base and at the pinned commit.
   * `null` when the side does not exist (added / deleted files).
   * They power expand-context in the diff view.
   */
  oldContent: string | null;
  newContent: string | null;
}

/* ------------------------------------------------------------------ */
/* Navigation — model B, a nested tree (#12)                           */
/* ------------------------------------------------------------------ */

export type NavNode =
  | { kind: "group"; label: string; children: NavNode[] }
  | { kind: "section"; label: string; icon?: string; ref: string }
  /** A file-section: mono filename with CLI-computed status color. */
  | { kind: "file"; label: string; ref: string; status: FileStatus };

/* ------------------------------------------------------------------ */
/* Blocks — the 15-tag core catalog (#12) plus preset nodes (#17)      */
/* ------------------------------------------------------------------ */

export interface CodeBlock {
  b: "code";
  file: string;
  from: number;
  to: number;
  lang: string;
  /** Authored default view; the reader can switch in the app. */
  view: "plain" | "change" | "diff";
  /** Raw source lines `from..to` at the pinned commit. */
  lines: string[];
  /**
   * Change overlay (#11): absolute line numbers within `from..to` that the
   * PR added or modified, relative to the diff base.
   */
  changed: number[];
  /** Absolute line numbers to visually highlight (`mark=` attribute). */
  mark?: number[];
  /**
   * expect= tripwire status (#24). "mismatch" renders a warning ribbon in
   * soft `open`; `check` fails it hard.
   */
  expect?: { value: string; status: "ok" | "mismatch" };
}

export type Block =
  | { b: "md"; nodes: MdNode[] }
  | { b: "callout"; tone?: "key" | "warn"; body: Inline[] }
  | { b: "flow"; steps: { body: Inline[]; tag?: string }[] }
  | { b: "fields"; rows: FieldRow[] }
  | {
      b: "method";
      sig: string;
      decorator?: string;
      /** Preset-computed decorator chips (#17), e.g. "depends", "constrains". */
      chips?: string[];
      body: Inline[];
    }
  | { b: "tests"; items: TestItem[] }
  | { b: "matrix"; head: string[]; rows: { label: string; cells: boolean[] }[] }
  | {
      b: "table";
      head: Inline[][];
      rows: Inline[][][];
      firstColMono?: boolean;
    }
  | {
      /** Resolved `{% files /%}`: paths filtered per the tag's attributes; the
       *  entries themselves live in `Payload.files`. */
      b: "files";
      paths: string[];
    }
  | { b: "i18n"; rows: I18nRow[]; note?: Inline[] }
  | { b: "cards"; cols: 1 | 2 | 3; items: CardItem[] }
  | { b: "patterns"; items: PatternItem[] }
  | { b: "attrs"; items: string[] }
  | DiagramBlock
  | CodeBlock
  | PresetBlock;

/** Namespaced preset node (#17). Unknown kinds render a labeled placeholder. */
export interface PresetBlock {
  b: `${string}/${string}`;
  [key: string]: unknown;
}

export interface FieldRow {
  name: string;
  kind: string;
  /** Small tone chips, e.g. "computed", "readonly". */
  badges?: string[];
  /** Plain-data attribute chips (#13), e.g. `index=True`. */
  tags?: string[];
  note: Inline[];
}

export interface TestItem {
  name: string;
  kind: "unit" | "tour" | "http";
  ref?: string;
  scenario: Inline[];
  asserts: Inline[][];
}

export interface I18nRow {
  path: string;
  status: FileStatus;
  /** Language code for `.po` files; absent for the `.pot` template. */
  lang?: string;
  additions: number;
  deletions: number;
  /** CLI-computed gettext entry counts from the diff (#12). */
  entries: { new?: number; updated?: number; removed?: number };
  note?: string;
}

export interface CardItem {
  icon?: string;
  title?: string;
  body: Inline[][];
}

export interface PatternItem {
  icon?: string;
  term: string;
  ref?: string;
  body: Inline[];
}

export interface DiagramBlock {
  b: "diagram";
  intro?: Inline[];
  hint?: Inline[];
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface DiagramNode {
  id: string;
  model: string;
  nlabel?: string;
  change: "new" | "mod" | "ctx";
  badge?: string;
  /** Section id to jump to on click. */
  ref?: string;
  col: number;
  row: number;
  compartments: { label: string; rows: Inline[][] }[];
}

export interface DiagramEdge {
  from: string;
  to: string;
  kind: "new" | "mod" | "ctx" | "derived";
  label?: string;
  thick?: boolean;
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

export interface Section {
  id: string;
  title: string;
  icon?: string;
  badge?: { label: string; tone: "new" | "mod" | "del" };
  /** Renders the mono file path in the section header. */
  file?: string;
  /** Section ids of related file-sections (chips in the header). */
  relatedFiles?: string[];
  /** sha256 of the section's Markdoc source slice — review-state key (#14). */
  hash: string;
  blocks: Block[];
}

/* ------------------------------------------------------------------ */
/* Soft-open error cards (#15)                                         */
/* ------------------------------------------------------------------ */

export interface ErrorCard {
  code: CheckCode;
  message: string;
  /** The exact authored reference, e.g. `models/x.py:10-40`. */
  reference?: string;
  /** Section the failed block belongs to. */
  sectionId?: string;
  line?: number;
}

/* ------------------------------------------------------------------ */
/* The payload                                                         */
/* ------------------------------------------------------------------ */

export interface Payload {
  /** Input schema version carried by the file (#18). */
  walkthrough: 1;
  title: string;
  /** The stamped pin SHA the file was authored against. */
  commit: string;
  /** Commits between the stamp and the current PR head; > 0 shows the stale banner. */
  headDistance: number;
  /** Resolved chrome language: `meta.lang`, overridden by `--lang`. */
  lang: "en" | "fr";
  /** Free domain keys; rendered as header chips. */
  meta: Record<string, string>;
  /** Active preset name, when the frontmatter declares one. */
  preset?: string;
  pr: {
    number: number;
    url: string;
    author: string;
    state: "open" | "closed" | "merged";
    base: string;
    head: string;
    commits: number;
    stats: { files: number; additions: number; deletions: number };
  };
  /** All changed files of the PR at the pin, keyed into by path. */
  files: FileEntry[];
  nav: NavNode[];
  sections: Section[];
  /** Unresolvable references, rendered as in-app error cards (soft open). */
  errors: ErrorCard[];
  /** Repo-relative path of the source file, e.g. `walkthroughs/pr-96.md`. */
  sourcePath: string;
  /** localStorage key prefix for the static export (#14). */
  storageKey: string;
}

/* ------------------------------------------------------------------ */
/* Review state (#14) — served mode persists via GET/PUT, export via   */
/* localStorage under `balade:<repo>#<pr>:<walkthrough>`.              */
/* ------------------------------------------------------------------ */

export interface ReviewMark {
  /** The content hash the mark was made against; mismatch resets the mark. */
  hash: string;
  /** ISO timestamp of the click. */
  at: string;
}

export interface ReviewState {
  version: 1;
  walkthrough: string;
  pr: number;
  stamp: string;
  /** Keyed by section id. */
  sections: Record<string, ReviewMark>;
  /** Keyed `<section-id>//<path>` — the same path in two browsers keeps independent state. */
  files: Record<string, ReviewMark>;
}

/* ------------------------------------------------------------------ */
/* Multi-walkthrough index (#21)                                       */
/* ------------------------------------------------------------------ */

export interface IndexEntry {
  path: string;
  title: string;
  pr: number;
  meta: Record<string, string>;
  /** `git log -1` date of the file, ISO. */
  updatedAt: string;
  /** From the local `.balade/` state file; absent when never opened. */
  progress?: { done: number; total: number };
}

export interface IndexPayload {
  kind: "index";
  repo: string;
  entries: IndexEntry[];
}

/* ------------------------------------------------------------------ */
/* check — the validation surface (#11, #24)                           */
/* ------------------------------------------------------------------ */

export type CheckCode =
  /* schema errors come from Markdoc with their own ids; these are ours */
  | "frontmatter-missing"
  | "frontmatter-invalid"
  | "frontmatter-key-unknown"
  | "section-id-duplicate"
  | "preset-unknown"
  | "preset-tag-inactive"
  | "file-unresolvable"
  | "range-unresolvable"
  | "stale-overlap"
  | "expect-missing"
  | "expect-mismatch"
  | (string & {}); /* Markdoc schema error ids pass through */

export interface CheckDiagnostic {
  code: CheckCode;
  level: "error" | "warning";
  /** Repo-relative path of the walkthrough file. */
  file: string;
  /** 1-based line in the walkthrough file, when known. */
  line?: number;
  message: string;
  /** Actionable fix hint — every diagnostic carries one. */
  hint?: string;
  /** expect-mismatch detail: the quote vs the actual resolved first line. */
  expected?: string;
  actual?: string;
}

/** Boundary echo (#24): first and last resolved line of every code range. */
export interface RangeEcho {
  file: string;
  from: number;
  to: number;
  firstLine: string;
  lastLine: string;
  /** Walkthrough-file line of the `code` tag, for cross-reference. */
  atLine?: number;
}

export interface CheckReport {
  file: string;
  ok: boolean;
  diagnostics: CheckDiagnostic[];
  ranges: RangeEcho[];
}
