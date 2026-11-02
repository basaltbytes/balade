/** Source coordinates shared by Git resolution and stored-payload answers. */
export function sourceLines(content: string): string[] {
  const lines = content.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Absolute added/modified line numbers from a unified diff with any context size. */
export function changedLines(body: string): Set<number> {
  const changed = new Set<number>();
  let next = 0;
  for (const line of body.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk !== null) {
      next = Number(hunk[1]);
    } else if (next > 0 && line.startsWith("+")) {
      changed.add(next++);
    } else if (next > 0 && line.startsWith(" ")) {
      next++;
    }
  }
  return changed;
}
