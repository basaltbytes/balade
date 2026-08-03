import { describe, expect, it } from "@effect/vitest";
import { FastCheck } from "effect/testing";
import { changedLines, splitDiff } from "../src/resolve/diff.js";

const DIFF = `diff --git a/models/pool.py b/models/pool.py
index 1111111..2222222 100644
--- a/models/pool.py
+++ b/models/pool.py
@@ -1 +1 @@
-from odoo import fields, models
+from odoo import api, fields, models
@@ -6,0 +7 @@ class PoolItem(models.Model):
+    _auto = False
@@ -9,0 +11,6 @@ class PoolItem(models.Model):
+    placed = fields.Float()
+
+    @api.depends("slot_ids")
+    def _compute_placed(self):
+        for item in self:
+            item.placed = 0.0
diff --git a/docs/old.md b/docs/old.md
deleted file mode 100644
index 3333333..0000000
--- a/docs/old.md
+++ /dev/null
@@ -1 +0,0 @@
-# Superseded
`;

const diffLineCharacter = FastCheck.constantFrom(
  ...Array.from("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _-./@"),
);
const diffLine = FastCheck.array(diffLineCharacter, { maxLength: 60 }).map((characters) =>
  characters.join(""),
);
const pathSegment = FastCheck.array(
  FastCheck.constantFrom(
    ...Array.from("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"),
  ),
  { minLength: 1, maxLength: 12 },
).map((characters) => characters.join(""));
const diffFile = FastCheck.record({
  path: FastCheck.tuple(pathSegment, pathSegment).map(
    ([directory, name]) => `${directory}/${name}.txt`,
  ),
  removed: diffLine,
  added: diffLine,
});
const diffFiles = FastCheck.uniqueArray(diffFile, {
  selector: ({ path }) => path,
  maxLength: 6,
});

describe("unified diff", () => {
  it.prop("round-trips adjacent generated file records", [diffFiles], ([files]) => {
    const raw = files
      .map(
        ({ path, removed, added }) =>
          `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-${removed}\n+${added}\n`,
      )
      .join("");

    expect(splitDiff(raw)).toEqual(
      files.map(({ path, removed, added }) => ({
        path,
        oldPath: null,
        body: `@@ -1 +1 @@\n-${removed}\n+${added}\n`,
        binary: false,
      })),
    );
  });

  it("splits one diff into per-file records", () => {
    const records = splitDiff(DIFF);
    expect(records.map((record) => record.path)).toEqual(["models/pool.py", "docs/old.md"]);
    expect(records[0]?.body.startsWith("@@ -1 +1 @@")).toBe(true);
    expect(records[0]?.binary).toBe(false);
    expect(records[1]?.path).toBe("docs/old.md");
  });

  it("reads the change overlay off the hunk headers", () => {
    const record = splitDiff(DIFF)[0];
    expect([...changedLines(record?.body ?? "")]).toEqual([1, 7, 11, 12, 13, 14, 15, 16]);
  });

  it("marks a deleted file as changing nothing on the new side", () => {
    const record = splitDiff(DIFF)[1];
    expect([...changedLines(record?.body ?? "")]).toEqual([]);
  });

  it("reads a binary record", () => {
    const records = splitDiff(
      "diff --git a/logo.png b/logo.png\nindex 1111111..2222222 100644\nBinary files a/logo.png and b/logo.png differ\n",
    );
    expect(records[0]).toMatchObject({ path: "logo.png", binary: true, body: "" });
  });
});
