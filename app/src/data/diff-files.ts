/* The rows of a file diff browser, from either source: a walkthrough payload's
   file entries or a host's own list of changed files. Pure and free of React. */

import { Result, Schema } from "effect";
import { langOf } from "../../../src/contract/lang";
import type { FileEntry } from "../contract";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const DiffPatch = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("text"),
    /** Unified diff text, with or without the `---`/`+++` header. */
    text: Schema.String,
    /** The text stops before the end of the file's diff. */
    truncated: Schema.optionalKey(Schema.Boolean),
  }),
  Schema.Struct({ kind: Schema.Literal("binary") }),
  /** No patch was supplied, for example because the file's diff is too large. */
  Schema.Struct({ kind: Schema.Literal("omitted") }),
]);

/** One changed file a host supplies to `Diff`. */
export const DiffFile = Schema.Struct({
  path: Schema.String,
  /** The path before a rename. */
  oldPath: Schema.optionalKey(Schema.String),
  status: Schema.Literals(["added", "modified", "removed", "renamed"]),
  additions: Count,
  deletions: Count,
  patch: DiffPatch,
  test: Schema.optionalKey(Schema.Boolean),
  generated: Schema.optionalKey(Schema.Boolean),
});

export type DiffPatch = typeof DiffPatch.Type;
export type DiffFile = typeof DiffFile.Type;

export type RowPatch =
  | {
      readonly kind: "text";
      readonly unified: string;
      readonly oldContent: string | null;
      readonly newContent: string | null;
      readonly truncated: boolean;
    }
  | { readonly kind: "binary" }
  | { readonly kind: "omitted" };

export interface DiffRow {
  readonly path: string;
  readonly oldPath: string | undefined;
  readonly status: FileEntry["status"];
  readonly additions: number;
  readonly deletions: number;
  readonly lang: string;
  readonly patch: RowPatch;
  readonly test: boolean;
  readonly generated: boolean;
}

export function rowOfEntry(entry: FileEntry): DiffRow {
  return {
    path: entry.path,
    oldPath: entry.oldPath,
    status: entry.status,
    additions: entry.additions,
    deletions: entry.deletions,
    lang: entry.lang,
    patch:
      entry.diff === null
        ? { kind: "binary" }
        : {
            kind: "text",
            unified: entry.diff.unified,
            oldContent: entry.diff.oldContent,
            newContent: entry.diff.newContent,
            truncated: false,
          },
    test: false,
    generated: false,
  };
}

const STATUS = { added: "A", modified: "M", removed: "D", renamed: "R" } as const;

function rowOfFile(file: DiffFile): DiffRow {
  return {
    path: file.path,
    oldPath: file.oldPath,
    status: STATUS[file.status],
    additions: file.additions,
    deletions: file.deletions,
    lang: langOf(file.path),
    patch:
      file.patch.kind === "text"
        ? {
            kind: "text",
            unified: file.patch.text,
            oldContent: null,
            newContent: null,
            truncated: file.patch.truncated === true,
          }
        : file.patch,
    test: file.test === true,
    generated: file.generated === true,
  };
}

export class DiffFilesInvalid extends Schema.TaggedErrorClass<DiffFilesInvalid>()(
  "DiffFilesInvalid",
  { cause: Schema.Defect() },
) {}

const decodeFiles = Schema.decodeUnknownResult(Schema.Array(DiffFile));

/**
 * Checks host files at the component boundary, for JavaScript callers. The
 * schema has no transformations, so a file that passes is used as given and
 * host callbacks receive the caller's own objects.
 */
export function decodeDiffFiles(
  input: ReadonlyArray<DiffFile>,
): Result.Result<
  ReadonlyArray<{ readonly file: DiffFile; readonly row: DiffRow }>,
  DiffFilesInvalid
> {
  return decodeFiles(input).pipe(
    Result.map(() => input.map((file) => ({ file, row: rowOfFile(file) }))),
    Result.mapError((cause) => new DiffFilesInvalid({ cause })),
  );
}

/** What a set of files adds up to. */
export function totals(
  files: ReadonlyArray<{ readonly additions: number; readonly deletions: number }>,
) {
  return {
    files: files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}

export type Totals = ReturnType<typeof totals>;

/** A host link is followed only when it resolves to HTTP or HTTPS. */
export function hostHref(href: string): string | undefined {
  const url = URL.parse(href, "https://balade.invalid/");
  return url !== null && (url.protocol === "http:" || url.protocol === "https:") ? href : undefined;
}
