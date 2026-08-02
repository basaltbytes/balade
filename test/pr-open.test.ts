/**
 * `open` pointed at a pull request (spec #26, #27): the argument classifier,
 * the locator's two tiers — working tree, then the fetched `pull/<n>/head`
 * ref — and a served session that never needed the branch checked out.
 */

import { Effect } from "effect";
import { realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Payload } from "../src/payload/types.js";
import { PrLocator, type Located, type LocateError } from "../src/pr/locate.js";
import { parseOpenTarget, parsePrTarget } from "../src/pr/target.js";
import { repoSlug } from "../src/resolve/git.js";
import { prepareSession } from "../src/server/session.js";
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

const locate = (cwd: string, number: number, slug: string | null): Located =>
  Effect.runSync(
    Effect.gen(function* () {
      const locator = yield* PrLocator;
      return yield* locator.locate(cwd, { number, slug });
    }).pipe(Effect.provide(PrLocator.layer)),
  );

const locateError = (cwd: string, number: number, slug: string | null): LocateError =>
  Effect.runSync(
    Effect.gen(function* () {
      const locator = yield* PrLocator;
      return yield* Effect.flip(locator.locate(cwd, { number, slug }));
    }).pipe(Effect.provide(PrLocator.layer)),
  );

describe("the locator", () => {
  let origin: FixtureRepo;
  let clone: FixtureClone;

  it("uses the Windows root basename when no origin URL is readable", () => {
    expect(repoSlug(String.raw`C:\Users\RUNNER~1\AppData\Local\Temp\balade-clone-example`)).toBe(
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

  it("finds the walkthrough in the working tree when the branch is checked out", () => {
    const located = locate(origin.dir, 42, null);
    expect(located.paths).toEqual(["walkthroughs/valid.md"]);
    expect(located.at).toBeUndefined();
  });

  it("stops when the URL names another repository", () => {
    const error = locateError(clone.dir, 42, "acme/other");
    expect(error._tag).toBe("WrongRepository");
    expect(error.note).toContain("acme/other");
  });

  it("accepts the URL slug the origin remote answers", () => {
    const located = locate(clone.dir, 42, repoSlug(clone.dir));
    expect(located.paths).toEqual(["walkthroughs/valid.md"]);
  });

  it("fetches pull/<n>/head when the working tree has nothing", () => {
    const located = locate(clone.dir, 42, null);
    /* Git and Node can spell the same path differently across platforms. */
    expect(realpathSync.native(located.root)).toBe(realpathSync.native(clone.dir));
    expect(located.paths).toEqual(["walkthroughs/valid.md"]);
    expect(located.at).toMatch(/^[0-9a-f]{40}$/);
  });

  it("says when the PR cannot be fetched", () => {
    const error = locateError(clone.dir, 99, null);
    expect(error._tag).toBe("PullFetchFailed");
    expect(error.note).toContain("pull/99/head");
  });

  it("says when the fetched PR carries no walkthrough", () => {
    const error = locateError(clone.dir, 7, null);
    expect(error._tag).toBe("NoWalkthroughForPull");
    expect(error.note).toContain("PR #7");
  });
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

  it("serves the walkthrough read at the fetched commit", () => {
    const located = locate(clone.dir, 42, null);
    const prepared = prepareSession({
      cwd: clone.dir,
      selection: { kind: "located", ...located },
      useGh: false,
      warn: () => {},
    });
    if (prepared.kind !== "ready") throw new Error(`open refused to start: ${prepared.kind}`);
    const session = prepared.session;

    expect(session.paths).toEqual(["walkthroughs/valid.md"]);
    expect(session.outcome.ok).toBe(true);

    const answer = session.api.walkthrough(null);
    if (answer.kind !== "json") throw new Error("expected a payload");
    const payload = answer.body as Payload;
    expect(payload.walkthrough).toBe(1);
    expect(payload.pr.number).toBe(42);
    expect(payload.sourcePath).toBe("walkthroughs/valid.md");

    /* Review state lands in the clone's `.balade/`, keyed by walkthrough path. */
    const written = session.api.writeState("walkthroughs/valid.md", {
      version: 1,
      walkthrough: "walkthroughs/valid.md",
      pr: 42,
      stamp: payload.commit,
      sections: {},
      files: {},
    });
    expect(written.kind).toBe("json");

    session.close();
  });

  it("never wrote the walkthrough into the working tree", () => {
    expect(() => rmSync(join(clone.dir, "walkthroughs"), { recursive: true })).toThrow();
  });
});
