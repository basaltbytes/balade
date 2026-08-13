/** Generated-walkthrough output policy through the real filesystem seam. */

import { Effect } from "effect";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import {
  findGeneratedWalkthroughs,
  writeGenerationDraft,
} from "../src/commands/generate/output.js";
import { shellLayer } from "./support/effect.js";
import { createFixtureRepo } from "./support/repo.js";

const fixture = Effect.acquireRelease(Effect.sync(createFixtureRepo), (repo) =>
  Effect.sync(() => repo.cleanup()),
);

const stamped = (pin: string): string => `---
walkthrough: 1
title: Existing walkthrough
pr: 42
commit: ${pin}
meta: {}
---

Existing body.
`;

describe("generation output", () => {
  it.effect("finds only same-PR walkthroughs before authoring starts", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      repo.write("walkthroughs/pr-42-older.md", stamped(repo.pin));
      repo.write("walkthroughs/pr-42-newer.md", stamped(repo.pin));
      repo.write("walkthroughs/pr-7-unrelated.md", stamped(repo.pin));
      repo.write("walkthroughs/notes.txt", "ignore me\n");

      const files = yield* findGeneratedWalkthroughs({
        root: repo.dir,
        directory: "walkthroughs",
        pullNumber: 42,
      });

      expect(files).toEqual(["walkthroughs/pr-42-newer.md", "walkthroughs/pr-42-older.md"]);
    }).pipe(Effect.provide(shellLayer)),
  );

  it.effect("retains a completed collision and reports a changed head", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      const file = join(repo.dir, "walkthroughs/pr-42-refreshed-review.md");
      repo.write("walkthroughs/pr-42-refreshed-review.md", stamped(repo.pin));

      const error = yield* writeGenerationDraft({
        root: repo.dir,
        directory: "walkthroughs",
        pullNumber: 42,
        title: "Refreshed review",
        contents: "completed new draft\n",
        currentHead: "new-pull-request-head",
        collisionPolicy: "exclusive",
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OutputAlreadyExists");
      if (error._tag !== "OutputAlreadyExists") return;
      expect(error.existing).toMatchObject({ _tag: "ExistingDifferentHead", pin: repo.pin });
      expect(readFileSync(file, "utf8")).toBe(stamped(repo.pin));
      expect(readFileSync(error.retainedFile, "utf8")).toBe("completed new draft\n");
    }).pipe(Effect.provide(shellLayer)),
  );

  it.effect("distinguishes a same-head collision through the real file stamp", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      repo.write("walkthroughs/pr-42-same-head.md", stamped(repo.pin));

      const error = yield* writeGenerationDraft({
        root: repo.dir,
        directory: "walkthroughs",
        pullNumber: 42,
        title: "Same head",
        contents: "completed same-head reroll\n",
        currentHead: repo.pin,
        collisionPolicy: "exclusive",
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OutputAlreadyExists");
      if (error._tag !== "OutputAlreadyExists") return;
      expect(error.existing._tag).toBe("ExistingSameHead");
      expect(readFileSync(error.retainedFile, "utf8")).toBe("completed same-head reroll\n");
      expect(basename(error.retainedFile)).toMatch(/^pr-42-same-head-recovered-.+\.md$/u);
    }).pipe(Effect.provide(shellLayer)),
  );

  it.effect("retains the draft when the colliding stamp cannot be read", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      const target = join(repo.dir, "walkthroughs/pr-42-directory-target.md");
      mkdirSync(target, { recursive: true });

      const error = yield* writeGenerationDraft({
        root: repo.dir,
        directory: "walkthroughs",
        pullNumber: 42,
        title: "Directory target",
        contents: "completed unreadable collision\n",
        currentHead: repo.pin,
        collisionPolicy: "exclusive",
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OutputAlreadyExists");
      if (error._tag !== "OutputAlreadyExists") return;
      expect(error.existing._tag).toBe("ExistingStampUnreadable");
      expect(readFileSync(error.retainedFile, "utf8")).toBe("completed unreadable collision\n");
    }).pipe(Effect.provide(shellLayer)),
  );

  it.effect("keeps output inspection failures out of the write-error dialect", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      repo.write("not-a-directory", "plain file\n");

      const error = yield* findGeneratedWalkthroughs({
        root: repo.dir,
        directory: "not-a-directory",
        pullNumber: 42,
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OutputAccessFailed");
      if (error._tag !== "OutputAccessFailed") return;
      expect(error.operation).toBe("list");
    }).pipe(Effect.provide(shellLayer)),
  );

  it.effect("force atomically replaces one filename and reports untouched siblings", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      repo.write("walkthroughs/pr-42-refreshed-review.md", "old target\n");
      repo.write("walkthroughs/pr-42-french-review.md", "keep sibling\n");

      const written = yield* writeGenerationDraft({
        root: repo.dir,
        directory: "walkthroughs",
        pullNumber: 42,
        title: "Refreshed review",
        contents: "replacement\n",
        currentHead: repo.pin,
        collisionPolicy: "replace",
      });

      expect(readFileSync(written.file, "utf8")).toBe("replacement\n");
      expect(readFileSync(join(repo.dir, "walkthroughs/pr-42-french-review.md"), "utf8")).toBe(
        "keep sibling\n",
      );
      expect(written.siblings).toEqual(["walkthroughs/pr-42-french-review.md"]);
      expect(readdirSync(join(repo.dir, "walkthroughs"))).not.toContainEqual(
        expect.stringContaining(".balade-write-"),
      );
    }).pipe(Effect.provide(shellLayer)),
  );
});
