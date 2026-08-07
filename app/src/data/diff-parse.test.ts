/* The seam most likely to break silently: `@git-diff-view` drops a diff whose
   body has no `+++` header, and it drops it quietly. These tests parse every
   diff the app hands it and check the counts come back. */

import { DiffFile } from "@git-diff-view/react";
import { describe, expect, it } from "vitest";
import { pr96 } from "../fixtures/pr96";
import { codeExcerptHunk, normalizeUnified } from "./diff";

const parse = (
  unified: string,
  oldContent: string | null,
  newContent: string | null,
  lang: string,
): DiffFile => {
  const file = DiffFile.createInstance({
    oldFile: { fileName: "old", fileLang: lang, content: oldContent },
    newFile: { fileName: "new", fileLang: lang, content: newContent },
    hunks: [unified],
  });
  file.initRaw();
  return file;
};

describe("the fixture's diffs, through the real parser", () => {
  for (const entry of pr96.files) {
    if (!entry.diff) continue;
    it(`parses ${entry.path} and recovers +${entry.additions} −${entry.deletions}`, () => {
      const file = parse(
        normalizeUnified(entry.diff!.unified, entry.path, entry.oldPath),
        entry.diff!.oldContent,
        entry.diff!.newContent,
        entry.lang,
      );
      expect(file.additionLength).toBe(entry.additions);
      expect(file.deletionLength).toBe(entry.deletions);
    });
  }

  it("keeps expand-context available where both sides exist", () => {
    const modified = pr96.files.find((file) => file.status === "M" && file.diff !== null);
    expect(modified).toBeDefined();
    const file = parse(
      normalizeUnified(modified!.diff!.unified, modified!.path),
      modified!.diff!.oldContent,
      modified!.diff!.newContent,
      modified!.lang,
    );
    expect(file.getExpandEnabled()).toBe(true);
  });
});

describe("the code block's excerpt diff, through the real parser", () => {
  it("parses and reports every overlay line as an addition", () => {
    const lines = ["def a():", "    return 1", "    return 2"];
    const hunk = codeExcerptHunk(lines, [41, 42], 40, "models/x.py") ?? "";
    const file = parse(hunk, null, null, "python");
    file.buildSplitDiffLines();
    expect(file.additionLength).toBe(2);
    expect(file.deletionLength).toBe(0);
    const indexes = Array.from({ length: file.splitLineLength }, (_, index) => index);
    expect(indexes.map((index) => file.getSplitLeftLine(index).lineNumber)).toEqual([
      40,
      undefined,
      undefined,
    ]);
    expect(indexes.map((index) => file.getSplitRightLine(index).lineNumber)).toEqual([40, 41, 42]);
    expect(file.hasSomeLineCollapsed).toBe(false);
    expect(file.getExpandEnabled()).toBe(false);
  });
});
