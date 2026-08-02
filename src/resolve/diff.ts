/**
 * Pure unified-diff parsing. Input is the raw output of one `git diff` run
 * over the whole PR; output is per-file records the resolver keys by path.
 */

export interface DiffRecord {
  /** Path on the new side, or the old path for a deletion. */
  path: string;
  oldPath: string | null;
  /** Hunks only — from the first `@@` on. Empty for binaries and pure renames. */
  body: string;
  binary: boolean;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function pathFromMarker(line: string, prefix: string): string | null {
  if (!line.startsWith(prefix)) return null;
  const raw = line.slice(prefix.length).trim();
  if (raw === "/dev/null") return null;
  const cut = raw.indexOf("\t");
  const value = cut === -1 ? raw : raw.slice(0, cut);
  return value.length > 2 && (value.startsWith("a/") || value.startsWith("b/"))
    ? value.slice(2)
    : value;
}

/** Splits `git diff` output into one record per file. */
export function splitDiff(raw: string): DiffRecord[] {
  if (raw.trim() === "") return [];
  const lines = raw.split("\n");
  const records: DiffRecord[] = [];
  let start = -1;
  const flush = (end: number): void => {
    if (start === -1) return;
    const chunk = lines.slice(start, end);
    let oldPath: string | null = null;
    let newPath: string | null = null;
    let binary = false;
    let bodyStart = -1;
    for (let i = 0; i < chunk.length; i++) {
      const line = chunk[i] ?? "";
      if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) binary = true;
      if (oldPath === null && line.startsWith("--- ")) oldPath = pathFromMarker(line, "--- ");
      if (newPath === null && line.startsWith("+++ ")) newPath = pathFromMarker(line, "+++ ");
      if (line.startsWith("rename from ")) oldPath = line.slice("rename from ".length);
      if (line.startsWith("rename to ")) newPath = line.slice("rename to ".length);
      if (bodyStart === -1 && HUNK.test(line)) bodyStart = i;
    }
    if (newPath === null && oldPath === null) {
      /* A binary record carries no `---`/`+++` markers; read the header. */
      const header = /^diff --git a\/(.*?) b\/(.*)$/.exec(chunk[0] ?? "");
      if (header !== null) {
        oldPath = header[1] ?? null;
        newPath = header[2] ?? null;
      }
    }
    const path = newPath ?? oldPath;
    if (path !== null) {
      records.push({
        path,
        oldPath: oldPath !== null && oldPath !== path ? oldPath : null,
        body: bodyStart === -1 ? "" : chunk.slice(bodyStart).join("\n").replace(/\n+$/, "\n"),
        binary,
      });
    }
  };
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i] ?? "").startsWith("diff --git ")) {
      flush(i);
      start = i;
    }
  }
  flush(lines.length);
  return records;
}

/**
 * Change overlay: absolute new-file line numbers the PR added or
 * modified. Feed it a `-U0` diff body — every `+` line is a change.
 */
export function changedLines(body: string): Set<number> {
  const out = new Set<number>();
  for (const line of body.split("\n")) {
    const m = HUNK.exec(line);
    if (m === null) continue;
    const from = Number(m[3]);
    const count = m[4] === undefined ? 1 : Number(m[4]);
    for (let n = from; n < from + count; n++) out.add(n);
  }
  return out;
}
