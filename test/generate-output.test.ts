/** Generated-walkthrough output policy through the real filesystem and git seams. */

import { Effect } from "effect";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import {
  inspectExistingWalkthroughs,
  planSupersession,
  writeGenerationDraft,
  type ExistingWalkthrough,
} from "../src/commands/generate/output.js";
import { shellLayer } from "./support/effect.js";
import { createFixtureRepo } from "./support/repo.js";

const fixture = Effect.acquireRelease(Effect.sync(createFixtureRepo), (repo) =>
  Effect.sync(() => repo.cleanup()),
);

const OLDER_HEAD = "0123456789abcdef0123456789abcdef01234567";

const stamped = (pin: string, lang?: string): string => `---
walkthrough: 1
title: Existing walkthrough
pr: 42
commit: ${pin}
meta: {${lang === undefined ? "" : ` lang: ${lang} `}}
---

Existing body.
`;

describe("generation output", () => {
  it.effect("reads each same-PR stamp pre-flight and leaves other PRs alone", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      repo.write("walkthroughs/pr-42-stale.md", stamped(OLDER_HEAD));
      repo.write("walkthroughs/pr-42-current.md", stamped(repo.pin));
      repo.write("walkthroughs/pr-42-french.md", stamped(OLDER_HEAD, "fr"));
      repo.write("walkthroughs/pr-42-unstamped.md", "no frontmatter here\n");
      repo.write("walkthroughs/pr-7-unrelated.md", stamped(repo.pin));
      repo.write("walkthroughs/notes.txt", "ignore me\n");

      const existing = yield* inspectExistingWalkthroughs({
        root: repo.dir,
        directory: "walkthroughs",
        pullNumber: 42,
      });

      expect(existing.map((candidate) => [candidate.relativeFile, candidate.stamp])).toEqual([
        ["walkthroughs/pr-42-current.md", { _tag: "Stamped", pin: repo.pin, lang: "en" }],
        ["walkthroughs/pr-42-french.md", { _tag: "Stamped", pin: OLDER_HEAD, lang: "fr" }],
        ["walkthroughs/pr-42-stale.md", { _tag: "Stamped", pin: OLDER_HEAD, lang: "en" }],
        ["walkthroughs/pr-42-unstamped.md", { _tag: "Unstamped" }],
      ]);

      const plan = planSupersession(existing, repo.pin, "en");
      expect(plan.refreshing.map((candidate) => candidate.relativeFile)).toEqual([
        "walkthroughs/pr-42-stale.md",
      ]);
      expect(plan.undecided.map((candidate) => candidate.relativeFile)).toEqual([
        "walkthroughs/pr-42-current.md",
        "walkthroughs/pr-42-unstamped.md",
      ]);
      /* A French run conflicts with the French file only — plus the unprovable stamp. */
      expect(
        planSupersession(existing, repo.pin, "fr").refreshing.map(
          (candidate) => candidate.relativeFile,
        ),
      ).toEqual(["walkthroughs/pr-42-french.md"]);
    }).pipe(Effect.provide(shellLayer)),
  );

  it.effect("supersedes a committed re-slugged walkthrough by rename, without a copy", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      repo.write("walkthroughs/pr-42-old-title.md", stamped(OLDER_HEAD));
      repo.write("walkthroughs/pr-42-french-review.md", stamped(repo.pin, "fr"));
      repo.commit("docs: walkthroughs");
      const existing = yield* inspectExistingWalkthroughs({
        root: repo.dir,
        directory: "walkthroughs",
        pullNumber: 42,
      });
      const plan = planSupersession(existing, repo.pin, "en");

      const written = yield* writeGenerationDraft({
        root: repo.dir,
        directory: "walkthroughs",
        pullNumber: 42,
        title: "Refreshed review",
        contents: "refreshed draft\n",
        supersede: [...plan.refreshing, ...plan.undecided],
      });

      expect(readFileSync(written.file, "utf8")).toBe("refreshed draft\n");
      expect(existsSync(join(repo.dir, "walkthroughs/pr-42-old-title.md"))).toBe(false);
      expect(written.superseded).toEqual([{ file: "walkthroughs/pr-42-old-title.md" }]);
      expect(written.siblings).toEqual(["walkthroughs/pr-42-french-review.md"]);
      expect(readdirSync(join(repo.dir, "walkthroughs"))).not.toContainEqual(
        expect.stringContaining(".superseded"),
      );
    }).pipe(Effect.provide(shellLayer)),
  );

  it.effect("retains uncommitted superseded content beside the output, bounded to one copy", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      repo.write("walkthroughs/pr-42-hand-edited.md", stamped(OLDER_HEAD));
      repo.write("walkthroughs/pr-42-hand-edited.md.superseded", "previous retention\n");
      const existing = yield* inspectExistingWalkthroughs({
        root: repo.dir,
        directory: "walkthroughs",
        pullNumber: 42,
      });
      const plan = planSupersession(existing, repo.pin, "en");

      const written = yield* writeGenerationDraft({
        root: repo.dir,
        directory: "walkthroughs",
        pullNumber: 42,
        title: "Hand edited",
        contents: "replacement draft\n",
        supersede: [...plan.refreshing, ...plan.undecided],
      });

      /* Same identity, same slug: replaced in place, uncommitted content copied first. */
      expect(readFileSync(join(repo.dir, "walkthroughs/pr-42-hand-edited.md"), "utf8")).toBe(
        "replacement draft\n",
      );
      expect(written.superseded).toEqual([
        {
          file: "walkthroughs/pr-42-hand-edited.md",
          retainedAt: "walkthroughs/pr-42-hand-edited.md.superseded",
        },
      ]);
      expect(
        readFileSync(join(repo.dir, "walkthroughs/pr-42-hand-edited.md.superseded"), "utf8"),
      ).toBe(stamped(OLDER_HEAD));
      /* The retained copy is not a `.md` walkthrough: discovery and siblings skip it. */
      expect(written.siblings).toEqual([]);
    }).pipe(Effect.provide(shellLayer)),
  );

  it.effect("writes without superseding when the plan is empty", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      repo.write("walkthroughs/pr-42-french-review.md", stamped(repo.pin, "fr"));

      const written = yield* writeGenerationDraft({
        root: repo.dir,
        directory: "walkthroughs",
        pullNumber: 42,
        title: "First english review",
        contents: "english draft\n",
        supersede: [],
      });

      expect(readFileSync(written.file, "utf8")).toBe("english draft\n");
      expect(written.superseded).toEqual([]);
      expect(readFileSync(join(repo.dir, "walkthroughs/pr-42-french-review.md"), "utf8")).toBe(
        stamped(repo.pin, "fr"),
      );
      expect(written.siblings).toEqual(["walkthroughs/pr-42-french-review.md"]);
      expect(readdirSync(join(repo.dir, "walkthroughs"))).not.toContainEqual(
        expect.stringContaining(".balade-write-"),
      );
    }).pipe(Effect.provide(shellLayer)),
  );

  it.effect("tolerates a superseded file that vanished during the paid turn", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      const vanished: ExistingWalkthrough = {
        file: join(repo.dir, "walkthroughs/pr-42-vanished.md"),
        relativeFile: "walkthroughs/pr-42-vanished.md",
        stamp: { _tag: "Stamped", pin: OLDER_HEAD, lang: "en" },
      };

      const written = yield* writeGenerationDraft({
        root: repo.dir,
        directory: "walkthroughs",
        pullNumber: 42,
        title: "Vanished sibling",
        contents: "fresh draft\n",
        supersede: [vanished],
      });

      expect(readFileSync(written.file, "utf8")).toBe("fresh draft\n");
      expect(written.superseded).toEqual([{ file: "walkthroughs/pr-42-vanished.md" }]);
    }).pipe(Effect.provide(shellLayer)),
  );

  it.effect("keeps output inspection failures out of the write-error dialect", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      repo.write("not-a-directory", "plain file\n");

      const error = yield* inspectExistingWalkthroughs({
        root: repo.dir,
        directory: "not-a-directory",
        pullNumber: 42,
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OutputAccessFailed");
      if (error._tag !== "OutputAccessFailed") return;
      expect(error.operation).toBe("list");
    }).pipe(Effect.provide(shellLayer)),
  );
});
