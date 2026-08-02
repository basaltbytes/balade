import { describe, expect, it } from "vitest";
import { codeExcerptDiff, normalizeUnified, splitPath } from "./diff";

describe("normalizeUnified", () => {
  it("adds the ---/+++ pair the parser needs when the body starts at a hunk", () => {
    const out = normalizeUnified("@@ -1,2 +1,3 @@\n a\n+b\n c", "models/x.py");
    expect(out.split("\n").slice(0, 2)).toEqual(["--- a/models/x.py", "+++ b/models/x.py"]);
  });

  it("leaves a diff that already carries its headers alone", () => {
    const body = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b";
    expect(normalizeUnified(body, "x")).toBe(body);
  });

  it("names the old path on a rename", () => {
    const out = normalizeUnified("@@ -1 +1 @@\n-a\n+b", "new.py", "old.py");
    expect(out.startsWith("--- a/old.py\n+++ b/new.py\n")).toBe(true);
  });
});

describe("codeExcerptDiff", () => {
  it("turns the change overlay into additions against the lines it left alone", () => {
    const out = codeExcerptDiff(["ctx", "added", "tail"], [11], 10, "models/x.py");
    expect(out.oldContent).toBe("ctx\ntail");
    expect(out.newContent).toBe("ctx\nadded\ntail");
    const hunk = out.hunks[0] ?? "";
    expect(hunk).toContain("@@ -1,2 +1,3 @@");
    expect(hunk.endsWith(" ctx\n+added\n tail")).toBe(true);
  });

  it("covers the whole excerpt with one hunk, so nothing is left to expand", () => {
    const lines = ["a", "b", "c", "d"];
    const hunk = codeExcerptDiff(lines, [1, 2, 3, 4], 1, "x.py").hunks[0] ?? "";
    expect(hunk).toContain("@@ -0,0 +1,4 @@");
    expect(
      hunk.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")),
    ).toHaveLength(4);
  });
});

describe("splitPath", () => {
  it("splits a path into its directory and its name", () => {
    expect(splitPath("addons/acme/models/x.py")).toEqual(["addons/acme/models/", "x.py"]);
    expect(splitPath("README.md")).toEqual(["", "README.md"]);
  });
});
