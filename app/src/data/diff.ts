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

/**
 * The diff view of a `code` block, rebuilt from the only data the block has:
 * the excerpt's lines plus the change overlay. Overlay lines become additions
 * against an old side that simply lacks them — a modification cannot be
 * recovered from the payload, so it reads as an addition.
 *
 * One hunk covers the whole excerpt and starts both sides at the excerpt's
 * absolute `from` line, matching the plain and change views. The old-side
 * positions are synthetic because the payload has no pre-image range; using
 * `from` anchors them to the same absolute range instead of an excerpt-local
 * offset. The renderer composes both sides from this hunk, so it offers no
 * expand-context it could not honour.
 */
export function codeExcerptHunk(
  lines: ReadonlyArray<string>,
  changed: ReadonlyArray<number>,
  from: number,
  path: string,
): string {
  const added = new Set(changed);
  let oldCount = 0;
  const body: string[] = [];
  lines.forEach((line, index) => {
    if (added.has(from + index)) {
      body.push(`+${line}`);
    } else {
      oldCount++;
      body.push(` ${line}`);
    }
  });
  const header = `@@ -${oldCount === 0 ? 0 : from},${oldCount} +${lines.length === 0 ? 0 : from},${lines.length} @@`;
  return `--- a/${path}\n+++ b/${path}\n${header}\n${body.join("\n")}`;
}

/** `addons/acme/models/x.py` → `["addons/acme/models/", "x.py"]`. */
export function splitPath(path: string): [string, string] {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? ["", path] : [path.slice(0, cut + 1), path.slice(cut + 1)];
}
