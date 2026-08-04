/** Pinned authoring snapshots through the real filesystem and Git seams. */

import { Effect } from "effect";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { openPinnedRepositorySnapshot } from "../src/generate/snapshot.js";
import { createFixtureRepo } from "./support/repo.js";
import { provideLive } from "./support/effect.js";

const temporaryDirectory = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "balade-snapshot-test-"))),
  (directory) =>
    Effect.sync(() =>
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
    ),
);

const fixture = Effect.acquireRelease(Effect.sync(createFixtureRepo), (repo) =>
  Effect.sync(() => repo.cleanup()),
);

describe("pinned repository snapshots", () => {
  it.effect("materializes only the pin and rejects paths whose targets escape", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      const cacheRoot = yield* temporaryDirectory;
      const outside = yield* temporaryDirectory;
      const outsideFile = join(outside, "secret.txt");
      writeFileSync(outsideFile, "outside snapshot\n", "utf8");
      symlinkSync(outsideFile, join(repo.dir, "outside-link"));
      symlinkSync(outside, join(repo.dir, "outside-directory-link"), "dir");
      const pin = repo.commit("test: add escaping symlink");

      execFileSync("git", ["checkout", "main"], { cwd: repo.dir, stdio: "ignore" });
      repo.write("models/planning_pool_item.py", "dirty working tree\n");
      repo.write("untracked.txt", "not part of the pin\n");

      const snapshot = yield* openPinnedRepositorySnapshot({
        cacheRoot,
        repositoryRoot: repo.dir,
        pin,
      });
      const files = yield* snapshot.listFiles;
      const source = yield* snapshot.readFile("models/planning_pool_item.py");
      const symlinkEscape = yield* Effect.flip(snapshot.readFile("outside-link"));
      const directorySymlinkEscape = yield* Effect.flip(
        snapshot.readFile("outside-directory-link/secret.txt"),
      );
      const lexicalEscape = yield* Effect.flip(snapshot.readFile("../secret.txt"));

      expect(files).toContain("models/planning_pool_item.py");
      expect(files).toContain("outside-link");
      expect(files).toContain("outside-directory-link");
      expect(files).not.toContain("outside-directory-link/secret.txt");
      expect(files).not.toContain("untracked.txt");
      expect(source).toContain("from odoo import api, fields, models");
      expect(source).not.toContain("dirty working tree");
      expect(symlinkEscape._tag).toBe("SnapshotPathRejected");
      expect(directorySymlinkEscape._tag).toBe("SnapshotPathRejected");
      expect(lexicalEscape._tag).toBe("SnapshotPathRejected");
      expect(existsSync(join(snapshot.root, ".git"))).toBe(false);
    }).pipe(provideLive),
  );

  it.live("reuses a cached pin and evicts the least recently used snapshot", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      const cacheRoot = yield* temporaryDirectory;
      const first = yield* openPinnedRepositorySnapshot({
        cacheRoot,
        repositoryRoot: repo.dir,
        pin: repo.pin,
      });
      const firstInode = statSync(first.root).ino;

      yield* Effect.sleep("10 millis");
      repo.write("one.txt", "one\n");
      const secondPin = repo.commit("test: second snapshot");
      const second = yield* openPinnedRepositorySnapshot({
        cacheRoot,
        repositoryRoot: repo.dir,
        pin: secondPin,
      });

      yield* Effect.sleep("10 millis");
      const reused = yield* openPinnedRepositorySnapshot({
        cacheRoot,
        repositoryRoot: repo.dir,
        pin: repo.pin,
      });

      let latest = reused;
      for (const name of ["two", "three", "four", "five"] as const) {
        yield* Effect.sleep("10 millis");
        repo.write(`${name}.txt`, `${name}\n`);
        const pin = repo.commit(`test: ${name} snapshot`);
        latest = yield* openPinnedRepositorySnapshot({
          cacheRoot,
          repositoryRoot: repo.dir,
          pin,
        });
      }

      expect(reused.root).toBe(first.root);
      expect(statSync(reused.root).ino).toBe(firstInode);
      expect(existsSync(first.root)).toBe(true);
      expect(existsSync(second.root)).toBe(false);
      expect(readFileSync(join(latest.root, "five.txt"), "utf8")).toMatch(/^five\r?\n$/u);
    }).pipe(provideLive, Effect.scoped),
  );

  it.effect("rebuilds an entry whose pin marker no longer matches", () =>
    Effect.gen(function* () {
      const repo = yield* fixture;
      const cacheRoot = yield* temporaryDirectory;
      const first = yield* openPinnedRepositorySnapshot({
        cacheRoot,
        repositoryRoot: repo.dir,
        pin: repo.pin,
      });
      const entry = join(first.root, "..");
      writeFileSync(join(entry, "accessed"), "different-pin\n", "utf8");
      writeFileSync(join(first.root, "not-from-git.txt"), "cache tampering\n", "utf8");

      const rebuilt = yield* openPinnedRepositorySnapshot({
        cacheRoot,
        repositoryRoot: repo.dir,
        pin: repo.pin,
      });

      expect(existsSync(join(rebuilt.root, "not-from-git.txt"))).toBe(false);
      expect(yield* rebuilt.readFile("models/planning_pool_item.py")).toContain(
        "from odoo import api, fields, models",
      );
    }).pipe(provideLive),
  );
});
