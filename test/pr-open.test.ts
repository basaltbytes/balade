/**
 * `open` pointed at a pull request (spec #26, #27): the argument classifier,
 * the locator's two tiers — working tree, then the fetched `pull/<n>/head`
 * ref — and a served session that never needed the branch checked out.
 */

import { Effect } from "effect";
import { realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest";
import type { Payload } from "../src/payload/types.js";
import { locateErrorMessage, PrLocator } from "../src/pr/locate.js";
import { parseOpenTarget, parsePrTarget } from "../src/pr/target.js";
import { repoName, repoSlug } from "../src/resolve/git.js";
import { prepareSession } from "../src/server/session.js";
import { provideLive } from "./support/effect.js";
import {
  advertisePull,
  cloneOnMain,
  createFixtureRepo,
  type FixtureClone,
  type FixtureRepo,
} from "./support/repo.js";

describe("the open target", () => {
  it("reads a GitHub PR URL, with what follows the number ignored", () => {
    expect(parsePrTarget("https://github.com/acme/tools/pull/96")).toEqual({
      number: 96,
      slug: "acme/tools",
    });
    expect(parsePrTarget("https://github.com/acme/tools/pull/96/files#diff-abc")).toEqual({
      number: 96,
      slug: "acme/tools",
    });
  });

  it("reads #96 and bare digits, without a repository pin", () => {
    expect(parsePrTarget("#96")).toEqual({ number: 96, slug: null });
    expect(parsePrTarget("96")).toEqual({ number: 96, slug: null });
  });

  it("reads everything else as a path", () => {
    expect(parsePrTarget("walkthroughs/pr-96.md")).toBeNull();
    expect(parsePrTarget("https://gitlab.com/acme/tools/pull/96")).toBeNull();
  });

  it("classifies the argument list", () => {
    expect(parseOpenTarget([])).toEqual({ kind: "discovered" });
    expect(parseOpenTarget(["walkthroughs/a.md"])).toEqual({
      kind: "files",
      paths: ["walkthroughs/a.md"],
    });
    expect(parseOpenTarget(["#96"])).toEqual({ kind: "pr", pr: { number: 96, slug: null } });
    expect(parseOpenTarget(["#96", "walkthroughs/a.md"]).kind).toBe("invalid");
    expect(parseOpenTarget(["#96", "#97"]).kind).toBe("invalid");
  });
});

const locate = (cwd: string, number: number, slug: string | null) =>
  Effect.gen(function* () {
    const locator = yield* PrLocator;
    return yield* locator.locate(cwd, { number, slug });
  }).pipe(provideLive);

const locateError = (cwd: string, number: number, slug: string | null) =>
  Effect.gen(function* () {
    const locator = yield* PrLocator;
    return yield* Effect.flip(locator.locate(cwd, { number, slug }));
  }).pipe(provideLive);

describe("the locator", () => {
  let origin: FixtureRepo;
  let clone: FixtureClone;

  it("uses the Windows root basename when no origin URL is readable", () => {
    expect(repoName(String.raw`C:\Users\RUNNER~1\AppData\Local\Temp\balade-clone-example`)).toBe(
      "balade-clone-example",
    );
  });

  beforeAll(() => {
    origin = createFixtureRepo();
    origin.addWalkthrough("valid.md", "valid.md");
    clone = cloneOnMain(origin, 42);
    /* A PR that carries no walkthrough at all: its head is the pin commit. */
    advertisePull(origin, 7, origin.pin);
  });

  afterAll(() => {
    clone.cleanup();
    origin.cleanup();
  });

  it.effect("finds the walkthrough in the working tree when the branch is checked out", () =>
    Effect.gen(function* () {
      const located = yield* locate(origin.dir, 42, null);
      expect(located.paths).toEqual(["walkthroughs/valid.md"]);
      expect(located.at).toBeUndefined();
    }),
  );

  it.effect("stops when the URL names another repository", () =>
    Effect.gen(function* () {
      const error = yield* locateError(clone.dir, 42, "acme/other");
      expect(error._tag).toBe("WrongRepository");
      expect(locateErrorMessage(error)).toContain("acme/other");
    }),
  );

  it.effect("accepts the URL slug the origin remote answers", () =>
    Effect.gen(function* () {
      const located = yield* locate(clone.dir, 42, yield* provideLive(repoSlug(clone.dir)));
      expect(located.paths).toEqual(["walkthroughs/valid.md"]);
    }),
  );

  it.effect("fetches pull/<n>/head when the working tree has nothing", () =>
    Effect.gen(function* () {
      const located = yield* locate(clone.dir, 42, null);
      /* Git and Node can spell the same path differently across platforms. */
      expect(realpathSync.native(located.root)).toBe(realpathSync.native(clone.dir));
      expect(located.paths).toEqual(["walkthroughs/valid.md"]);
      expect(located.at).toMatch(/^[0-9a-f]{40}$/);
    }),
  );

  it.effect("says when the PR cannot be fetched", () =>
    Effect.gen(function* () {
      const error = yield* locateError(clone.dir, 99, null);
      expect(error._tag).toBe("PullFetchFailed");
      expect(locateErrorMessage(error)).toContain("pull/99/head");
    }),
  );

  it.effect("says when the fetched PR carries no walkthrough", () =>
    Effect.gen(function* () {
      const error = yield* locateError(clone.dir, 7, null);
      expect(error._tag).toBe("NoWalkthroughForPull");
      expect(locateErrorMessage(error)).toContain("PR #7");
    }),
  );

  it.effect("keeps an unusable repository path as a command failure", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(provideLive(repoSlug(join(clone.dir, "missing"))));
      expect(error._tag).toBe("CommandFailed");
    }),
  );
});

describe("a served PR without a checkout", () => {
  let origin: FixtureRepo;
  let clone: FixtureClone;

  beforeAll(() => {
    origin = createFixtureRepo();
    origin.addWalkthrough("valid.md", "valid.md");
    clone = cloneOnMain(origin, 42);
  });

  afterAll(() => {
    clone.cleanup();
    origin.cleanup();
  });

  it.effect("serves the walkthrough read at the fetched commit", () =>
    Effect.gen(function* () {
      const located = yield* locate(clone.dir, 42, null);
      const prepared = yield* provideLive(
        prepareSession({
          cwd: clone.dir,
          selection: { kind: "located", ...located },
          useGh: false,
        }),
      );
      if (prepared.kind !== "ready") throw new Error(`open refused to start: ${prepared.kind}`);
      const session = prepared.session;

      expect(session.paths).toEqual(["walkthroughs/valid.md"]);
      expect(session.outcome.ok).toBe(true);

      const payload = (yield* session.api.walkthrough(null)) as Payload;
      expect(payload.walkthrough).toBe(1);
      expect(payload.pr.number).toBe(42);
      expect(payload.sourcePath).toBe("walkthroughs/valid.md");

      /* Review state lands in the clone's `.balade/`, keyed by walkthrough path. */
      const written = yield* session.api.writeState("walkthroughs/valid.md", {
        version: 1,
        walkthrough: "walkthroughs/valid.md",
        pr: 42,
        stamp: payload.commit,
        sections: {},
        files: {},
      });
      expect(written.walkthrough).toBe("walkthroughs/valid.md");
    }),
  );

  it("never wrote the walkthrough into the working tree", () => {
    expect(() => rmSync(join(clone.dir, "walkthroughs"), { recursive: true })).toThrow();
  });
});
