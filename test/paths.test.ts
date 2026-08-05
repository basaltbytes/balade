import { Effect, FileSystem, Layer, Option, Path } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { repoRelative } from "../src/contract/paths.js";

const longRoot = "/Users/runneradmin/work/balade";
const shortRoot = "/Users/RUNNER~1/work/balade";

const info = (ino: number): FileSystem.File.Info => ({
  type: "Directory",
  mtime: Option.none(),
  atime: Option.none(),
  birthtime: Option.none(),
  dev: 1,
  ino: Option.some(ino),
  mode: 0,
  nlink: Option.none(),
  uid: Option.none(),
  gid: Option.none(),
  rdev: Option.none(),
  size: FileSystem.Size(0),
  blksize: Option.none(),
  blocks: Option.none(),
});

const testLayer = Layer.merge(
  Path.layer,
  FileSystem.layerNoop({
    realPath: (path) => Effect.succeed(path),
    stat: (path) => Effect.succeed(info(path === longRoot || path === shortRoot ? 42 : 7)),
  }),
);

describe("repo-relative paths", () => {
  it.effect("recognizes Windows long and 8.3 spellings by filesystem identity", () =>
    Effect.gen(function* () {
      const relative = yield* repoRelative(longRoot, `${shortRoot}/walkthroughs/valid.md`);
      expect(relative).toBe("walkthroughs/valid.md");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("keeps a lexical climb for a path that is genuinely outside the repository", () =>
    Effect.gen(function* () {
      const relative = yield* repoRelative(longRoot, "/Users/another/file.md");
      expect(relative).toBe("../../../another/file.md");
    }).pipe(Effect.provide(testLayer)),
  );
});
