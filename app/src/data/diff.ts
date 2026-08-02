/* Unified-diff shaping for the two diff surfaces, kept pure and free of React.

   `@git-diff-view`'s parser needs a `---`/`+++` pair before the first hunk: it
   returns an empty diff without one. The CLI's `FileEntry.diff.unified` may or
   may not carry those lines, so the renderer normalizes. */

const HUNK = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m;

export function normalizeUnified(unified: string, path: string, oldPath?: string): string {
  const body = unified.replace(/^\n+/, "");
  const head = body.slice(0, HUNK.exec(body)?.index ?? body.length);
  if (/^\+\+\+ /m.test(head)) return body;
  return `--- a/${oldPath ?? path}\n+++ b/${path}\n${body}`;
}

export interface CodeExcerptDiff {
  oldContent: string;
  newContent: string;
  hunks: string[];
}

/**
 * The diff view of a `code` block, rebuilt from the only data the block has:
 * the excerpt's lines plus the change overlay. Overlay lines become additions
 * against an old side that simply lacks them — a modification cannot be
 * recovered from the payload, so it reads as an addition.
 *
 * One hunk covers the whole excerpt, so nothing is hidden and the view offers
 * no expand-context it could not honour. Line numbers are excerpt-local; the
 * block header carries the file range.
 */
export function codeExcerptDiff(
  lines: string[],
  changed: number[],
  from: number,
  path: string,
): CodeExcerptDiff {
  const added = new Set(changed);
  const oldLines: string[] = [];
  const body: string[] = [];
  lines.forEach((line, index) => {
    if (added.has(from + index)) {
      body.push(`+${line}`);
    } else {
      oldLines.push(line);
      body.push(` ${line}`);
    }
  });
  const oldCount = oldLines.length;
  const header = `@@ -${oldCount === 0 ? 0 : 1},${oldCount} +${lines.length === 0 ? 0 : 1},${lines.length} @@`;
  return {
    oldContent: oldLines.join("\n"),
    newContent: lines.join("\n"),
    hunks: [`--- a/${path}\n+++ b/${path}\n${header}\n${body.join("\n")}`],
  };
}

/** `addons/acme/models/x.py` → `["addons/acme/models/", "x.py"]`. */
export function splitPath(path: string): [string, string] {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? ["", path] : [path.slice(0, cut + 1), path.slice(cut + 1)];
}
