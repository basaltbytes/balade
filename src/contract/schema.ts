/**
 * The resolved-payload contract as Effect Schema.
 *
 * These are deliberately plain schemas: decoding validates JSON-shaped data
 * without constructing classes or changing its representation. Every persisted
 * and transported type is derived from this module in `types.ts`.
 */

import { Schema } from "effect";

const Strings = Schema.Array(Schema.String);
const StringMap = Schema.Record(Schema.String, Schema.String);

/* ------------------------------------------------------------------ */
/* Inline rich text and markdown flow nodes                            */
/* ------------------------------------------------------------------ */

type InlineValue =
  | string
  | ReadonlyArray<InlineValue>
  | { readonly c: string }
  | { readonly b: ReadonlyArray<InlineValue> }
  | { readonly i: ReadonlyArray<InlineValue> }
  | { readonly m: string }
  | { readonly tag: string };

/** Recursive rich text; arrays are explicit fragment groups. */
export const Inline: Schema.Codec<InlineValue> = Schema.suspend(() =>
  Schema.Union([
    Schema.String,
    Schema.Array(Inline),
    Schema.Struct({ c: Schema.String }),
    Schema.Struct({ b: Schema.Array(Inline) }),
    Schema.Struct({ i: Schema.Array(Inline) }),
    Schema.Struct({ m: Schema.String }),
    Schema.Struct({ tag: Schema.String }),
  ]),
);

export const MdNode = Schema.Union([
  Schema.Struct({ p: Schema.Array(Inline) }),
  Schema.Struct({ h: Schema.String }),
  Schema.Struct({
    list: Schema.Array(Schema.Array(Inline)),
    ordered: Schema.optionalKey(Schema.Boolean),
  }),
]);

/* ------------------------------------------------------------------ */
/* Diff, files and navigation                                          */
/* ------------------------------------------------------------------ */

export const FileStatus = Schema.Literals(["A", "M", "D", "R"]);

export const FileDiff = Schema.Struct({
  unified: Schema.String,
  /** Full file contents at the diff base; `null` for an added file. */
  oldContent: Schema.NullOr(Schema.String),
  /** Full file contents at the pin; `null` for a deleted file. */
  newContent: Schema.NullOr(Schema.String),
});

/** One changed file of the PR, computed by the CLI at the pinned commit. */
export const FileEntry = Schema.Struct({
  path: Schema.String,
  /** Present when `status` is `R`. */
  oldPath: Schema.optionalKey(Schema.String),
  status: FileStatus,
  additions: Schema.Int,
  deletions: Schema.Int,
  /** Section id this file links to in nav and file rows. */
  ref: Schema.optionalKey(Schema.String),
  /** Author-supplied one-line rationale, mostly for deleted files. */
  why: Schema.optionalKey(Inline),
  /** sha256 of the diff text — the review-state reset key. */
  hash: Schema.String,
  /** Highlight language id for the renderer. */
  lang: Schema.String,
  /** `null` for binary files. */
  diff: Schema.NullOr(FileDiff),
});

type NavNodeValue =
  | {
      readonly kind: "group";
      readonly label: string;
      readonly children: ReadonlyArray<NavNodeValue>;
    }
  | {
      readonly kind: "section";
      readonly label: string;
      readonly icon?: string;
      readonly ref: string;
    }
  | {
      readonly kind: "file";
      readonly label: string;
      readonly ref: string;
      readonly status: "A" | "M" | "D" | "R";
    };

export const NavNode: Schema.Codec<NavNodeValue> = Schema.suspend(() =>
  Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("group"),
      label: Schema.String,
      children: Schema.Array(NavNode),
    }),
    Schema.Struct({
      kind: Schema.Literal("section"),
      label: Schema.String,
      icon: Schema.optionalKey(Schema.String),
      ref: Schema.String,
    }),
    Schema.Struct({
      kind: Schema.Literal("file"),
      label: Schema.String,
      ref: Schema.String,
      status: FileStatus,
    }),
  ]),
);

/* ------------------------------------------------------------------ */
/* Blocks — core nodes plus namespaced preset nodes                    */
/* ------------------------------------------------------------------ */

export const CodeBlock = Schema.Struct({
  b: Schema.Literal("code"),
  file: Schema.String,
  from: Schema.Int,
  to: Schema.Int,
  lang: Schema.String,
  /** Authored default; the reviewer can switch views in the app. */
  view: Schema.Literals(["plain", "change", "diff"]),
  /** Authored default; when true the block starts collapsed in the app. */
  collapsed: Schema.optionalKey(Schema.Boolean),
  /** Raw source lines at the pinned commit. */
  lines: Strings,
  /** Absolute line numbers the PR added or modified. */
  changed: Schema.Array(Schema.Int),
  /** Absolute line numbers the author asked to highlight. */
  mark: Schema.optionalKey(Schema.Array(Schema.Int)),
  /** The authored `expect=` tripwire and its resolved status. */
  expect: Schema.optionalKey(
    Schema.Struct({
      value: Schema.String,
      status: Schema.Literals(["ok", "mismatch"]),
    }),
  ),
});

export const FieldRow = Schema.Struct({
  name: Schema.String,
  kind: Schema.String,
  badges: Schema.optionalKey(Strings),
  tags: Schema.optionalKey(Strings),
  note: Schema.Array(Inline),
});

export const TestItem = Schema.Struct({
  name: Schema.String,
  kind: Schema.Literals(["unit", "tour", "http"]),
  ref: Schema.optionalKey(Schema.String),
  scenario: Schema.Array(Inline),
  asserts: Schema.Array(Schema.Array(Inline)),
});

export const I18nRow = Schema.Struct({
  path: Schema.String,
  status: FileStatus,
  lang: Schema.optionalKey(Schema.String),
  additions: Schema.Int,
  deletions: Schema.Int,
  entries: Schema.Struct({
    new: Schema.optionalKey(Schema.Int),
    updated: Schema.optionalKey(Schema.Int),
    removed: Schema.optionalKey(Schema.Int),
  }),
  note: Schema.optionalKey(Schema.String),
});

export const CardItem = Schema.Struct({
  icon: Schema.optionalKey(Schema.String),
  title: Schema.optionalKey(Schema.String),
  body: Schema.Array(Schema.Array(Inline)),
});

export const PatternItem = Schema.Struct({
  icon: Schema.optionalKey(Schema.String),
  term: Schema.String,
  ref: Schema.optionalKey(Schema.String),
  body: Schema.Array(Inline),
});

export const DiagramNode = Schema.Struct({
  id: Schema.String,
  model: Schema.String,
  nlabel: Schema.optionalKey(Schema.String),
  change: Schema.Literals(["new", "mod", "ctx"]),
  badge: Schema.optionalKey(Schema.String),
  ref: Schema.optionalKey(Schema.String),
  col: Schema.Int,
  row: Schema.Int,
  compartments: Schema.Array(
    Schema.Struct({
      label: Schema.String,
      rows: Schema.Array(Schema.Array(Inline)),
    }),
  ),
});

export const DiagramEdge = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  kind: Schema.Literals(["new", "mod", "ctx", "derived"]),
  label: Schema.optionalKey(Schema.String),
  thick: Schema.optionalKey(Schema.Boolean),
});

export const DiagramBlock = Schema.Struct({
  b: Schema.Literal("diagram"),
  intro: Schema.optionalKey(Schema.Array(Inline)),
  hint: Schema.optionalKey(Schema.Array(Inline)),
  nodes: Schema.Array(DiagramNode),
  edges: Schema.Array(DiagramEdge),
});

/** A renderer may not know the namespaced kind, but must preserve its JSON data. */
export const PresetBlock = Schema.StructWithRest(
  Schema.Struct({
    b: Schema.TemplateLiteral([Schema.String, "/", Schema.String]),
  }),
  [Schema.Record(Schema.String, Schema.Json)],
);

/** Core block variants are discriminated by their literal `b` field. */
export const Block = Schema.Union([
  Schema.Struct({ b: Schema.Literal("md"), nodes: Schema.Array(MdNode) }),
  Schema.Struct({
    b: Schema.Literal("callout"),
    tone: Schema.optionalKey(Schema.Literals(["key", "warn"])),
    body: Schema.Array(Inline),
  }),
  Schema.Struct({
    b: Schema.Literal("flow"),
    steps: Schema.Array(
      Schema.Struct({
        body: Schema.Array(Inline),
        tag: Schema.optionalKey(Schema.String),
      }),
    ),
  }),
  Schema.Struct({ b: Schema.Literal("fields"), rows: Schema.Array(FieldRow) }),
  Schema.Struct({
    b: Schema.Literal("method"),
    sig: Schema.String,
    decorator: Schema.optionalKey(Schema.String),
    chips: Schema.optionalKey(Strings),
    body: Schema.Array(Inline),
  }),
  Schema.Struct({ b: Schema.Literal("tests"), items: Schema.Array(TestItem) }),
  Schema.Struct({
    b: Schema.Literal("matrix"),
    head: Strings,
    rows: Schema.Array(
      Schema.Struct({ label: Schema.String, cells: Schema.Array(Schema.Boolean) }),
    ),
  }),
  Schema.Struct({
    b: Schema.Literal("table"),
    head: Schema.Array(Schema.Array(Inline)),
    rows: Schema.Array(Schema.Array(Schema.Array(Inline))),
    firstColMono: Schema.optionalKey(Schema.Boolean),
  }),
  Schema.Struct({ b: Schema.Literal("files"), paths: Strings }),
  Schema.Struct({
    b: Schema.Literal("i18n"),
    rows: Schema.Array(I18nRow),
    note: Schema.optionalKey(Schema.Array(Inline)),
  }),
  Schema.Struct({
    b: Schema.Literal("cards"),
    cols: Schema.Literals([1, 2, 3]),
    items: Schema.Array(CardItem),
  }),
  Schema.Struct({ b: Schema.Literal("patterns"), items: Schema.Array(PatternItem) }),
  Schema.Struct({ b: Schema.Literal("attrs"), items: Strings }),
  DiagramBlock,
  CodeBlock,
  PresetBlock,
]);

/* ------------------------------------------------------------------ */
/* Sections, errors and top-level payload                              */
/* ------------------------------------------------------------------ */

export const Section = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  icon: Schema.optionalKey(Schema.String),
  badge: Schema.optionalKey(
    Schema.Struct({
      label: Schema.String,
      tone: Schema.Literals(["new", "mod", "del"]),
    }),
  ),
  file: Schema.optionalKey(Schema.String),
  /** Ids of related sections, rendered as jump chips under the heading. */
  related: Schema.optionalKey(Strings),
  /** sha256 of this section's Markdoc source slice. */
  hash: Schema.String,
  blocks: Schema.Array(Block),
});

export const CheckCode = Schema.String;

export const ErrorCard = Schema.Struct({
  code: CheckCode,
  message: Schema.String,
  reference: Schema.optionalKey(Schema.String),
  sectionId: Schema.optionalKey(Schema.String),
  line: Schema.optionalKey(Schema.Int),
});

const PullRequest = Schema.Struct({
  number: Schema.Int,
  url: Schema.String,
  author: Schema.String,
  state: Schema.Literals(["open", "closed", "merged"]),
  base: Schema.String,
  head: Schema.String,
  commits: Schema.Int,
  stats: Schema.Struct({
    files: Schema.Int,
    additions: Schema.Int,
    deletions: Schema.Int,
  }),
});

export const Lang = Schema.Literals(["en", "fr"]);

export const Payload = Schema.Struct({
  /** Input schema version carried by the walkthrough. */
  walkthrough: Schema.Literal(1),
  title: Schema.String,
  /** Stamped pin SHA the walkthrough was authored against. */
  commit: Schema.String,
  /** Commits between the stamp and the current PR head. */
  headDistance: Schema.Int,
  /** Resolved chrome language after the optional CLI override. */
  lang: Lang,
  /** Free domain keys rendered as header chips. */
  meta: StringMap,
  preset: Schema.optionalKey(Schema.String),
  pr: PullRequest,
  /** All changed files at the pin. */
  files: Schema.Array(FileEntry),
  nav: Schema.Array(NavNode),
  sections: Schema.Array(Section),
  /** Unresolvable references rendered as soft-open cards. */
  errors: Schema.Array(ErrorCard),
  /** Repo-relative path of the source walkthrough. */
  sourcePath: Schema.String,
  /** localStorage key prefix for a static export. */
  storageKey: Schema.String,
});

/* ------------------------------------------------------------------ */
/* Review state and multi-walkthrough index                            */
/* ------------------------------------------------------------------ */

export const ReviewMark = Schema.Struct({
  hash: Schema.String,
  at: Schema.String,
});

export const ReviewState = Schema.Struct({
  version: Schema.Literal(1),
  walkthrough: Schema.String,
  pr: Schema.Int,
  stamp: Schema.String,
  /** Keyed by section id. */
  sections: Schema.Record(Schema.String, ReviewMark),
  /** Keyed by `<section-id>//<path>`. */
  files: Schema.Record(Schema.String, ReviewMark),
});

export const IndexEntry = Schema.Struct({
  path: Schema.String,
  title: Schema.String,
  pr: Schema.Int,
  meta: StringMap,
  updatedAt: Schema.String,
  progress: Schema.optionalKey(
    Schema.Struct({
      done: Schema.Int,
      total: Schema.Int,
    }),
  ),
});

export const IndexPayload = Schema.Struct({
  kind: Schema.Literal("index"),
  repo: Schema.String,
  entries: Schema.Array(IndexEntry),
});

/* ------------------------------------------------------------------ */
/* Check reports and source frontmatter                                */
/* ------------------------------------------------------------------ */

export const CheckDiagnostic = Schema.Struct({
  code: CheckCode,
  level: Schema.Literals(["error", "warning"]),
  /** Repo-relative path of the walkthrough. */
  file: Schema.String,
  /** 1-based source line when known. */
  line: Schema.optionalKey(Schema.Int),
  message: Schema.String,
  /** Actionable fix hint. */
  hint: Schema.optionalKey(Schema.String),
  expected: Schema.optionalKey(Schema.String),
  actual: Schema.optionalKey(Schema.String),
});

export const RangeEcho = Schema.Struct({
  file: Schema.String,
  from: Schema.Int,
  to: Schema.Int,
  firstLine: Schema.String,
  lastLine: Schema.String,
  atLine: Schema.optionalKey(Schema.Int),
});

export const CheckReport = Schema.Struct({
  file: Schema.String,
  ok: Schema.Boolean,
  diagnostics: Schema.Array(CheckDiagnostic),
  ranges: Schema.Array(RangeEcho),
});

export const Commit = Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9a-f]{7,40}$/i)));

export const Frontmatter = Schema.Struct({
  walkthrough: Schema.Literal(1),
  title: Schema.String,
  pr: Schema.Int,
  commit: Commit,
  meta: StringMap,
  preset: Schema.optionalKey(Schema.String),
});
