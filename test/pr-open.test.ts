/**
 * `open` pointed at a pull request (spec #26, #27): the argument classifier,
 * the locator's two tiers — working tree, then the fetched `pull/<n>/head`
 * ref — and a served session that never needed the branch checked out.
 */

import { Effect, Layer, Option } from "effect";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, assert, beforeAll, describe, expect, it } from "@effect/vitest";
import type { Payload } from "../src/contract/types.js";
import {
  locateErrorMessage,
  PrLocator,
  PullSourceReadFailed,
} from "../src/commands/open/locator.js";
import { PULL_COMMIT_SUBJECT_LIMIT } from "../src/git/intent.js";
import { fetchPullHead, parseOpenTarget, parsePrTarget, resolvePullHead } from "../src/git/pr.js";
import { CommandFailed } from "../src/contract/context.js";
import { readPullRequest, repoName, repoSlug, resolveCommit } from "../src/git/git.js";
import { prepareSession } from "../src/server/session.js";
import { CommandExecutor } from "../src/shell.js";
import { commandLayerWithGh, unavailableGhLayer } from "./support/command.js";
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
      expect(located.kind).toBe("workingTree");
      expect(located.paths).toEqual(["walkthroughs/valid.md"]);
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
      assert(located.kind === "pullHead", `expected a fetched pull head, got ${located.kind}`);
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

  it.effect("preserves the command failure when fetching the pull head fails", () =>
    Effect.gen(function* () {
      const failure = new CommandFailed({
        file: "git",
        args: ["ls-remote"],
        cwd: clone.dir,
        stderr: "network unavailable",
        code: 128,
      });
      const commandLayer = Layer.succeed(CommandExecutor, {
        exec: Effect.fn("CommandExecutor.fetchFailure")(function* () {
          return yield* failure;
        }),
      });

      const error = yield* Effect.flip(fetchPullHead(clone.dir, 42)).pipe(
        Effect.provide(commandLayer),
      );
      expect(error).toBe(failure);
    }),
  );

  it("includes the underlying source-read failure in the CLI message", () => {
    const message = locateErrorMessage(
      new PullSourceReadFailed({
        path: "/repo/walkthroughs/review.md",
        cause: new Error("permission denied"),
      }),
    );

    expect(message).toContain("permission denied");
  });

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
      assert(located.kind === "pullHead", `expected a fetched pull head, got ${located.kind}`);
      const prepared = yield* provideLive(
        prepareSession({
          cwd: clone.dir,
          selection: located,
          useGh: false,
        }),
      );
      if (prepared._tag !== "SessionReady") {
        throw new Error(`open refused to start: ${prepared._tag}`);
      }
      const session = prepared.session;

      expect(session.paths).toEqual(["walkthroughs/valid.md"]);
      expect(session.reports).toHaveLength(1);

      const payload = (yield* session.api.walkthrough(null)) as Payload;
      expect(payload.walkthrough).toBe(1);
      expect(payload.pr.number).toBe(42);
      expect(payload.sourcePath).toBe("walkthroughs/valid.md");

      /* Review state lands in the clone's `.balade/`, keyed by walkthrough path. */
      const written = yield* session.api.writeState(
        "walkthroughs/valid.md",
        JSON.stringify({
          version: 1,
          walkthrough: "walkthroughs/valid.md",
          pr: 42,
          stamp: payload.commit,
          sections: {},
          files: {},
        }),
      );
      expect(written.walkthrough).toBe("walkthroughs/valid.md");
    }),
  );

  it("never wrote the walkthrough into the working tree", () => {
    expect(() => rmSync(join(clone.dir, "walkthroughs"), { recursive: true })).toThrow();
  });
});

const pullFixture = Effect.acquireRelease(Effect.sync(createFixtureRepo), (repo) =>
  Effect.sync(() => repo.cleanup()),
);

describe("git revision resolution", () => {
  it.effect("treats a leading-dash ref as a revision rather than an option", () =>
    Effect.gen(function* () {
      const repo = yield* pullFixture;
      const ref = "--path-format=absolute";
      execFileSync("git", ["update-ref", `refs/heads/${ref}`, "HEAD"], { cwd: repo.dir });
      const expected = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: repo.dir,
        encoding: "utf8",
      }).trim();

      expect(Option.getOrUndefined(yield* provideLive(resolveCommit(repo.dir, ref)))).toBe(
        expected,
      );
    }),
  );
});

describe("pull-request authoring intent", () => {
  it.effect("rejects linked-issue URLs that do not identify a repository", () =>
    Effect.gen(function* () {
      const malformedUrl = "https://github.com/acme";
      const ghLayer = commandLayerWithGh(() =>
        Effect.succeed(
          JSON.stringify({
            url: "https://github.com/acme/planning/pull/42",
            state: "OPEN",
            author: { login: "reviewer" },
            baseRefName: "main",
            headRefName: "feature/pool",
            baseRefOid: "a".repeat(40),
            headRefOid: "b".repeat(40),
            commits: [],
            title: "Malformed linked issue provenance",
            body: "",
            closingIssuesReferences: [{ url: malformedUrl }],
          }),
        ),
      );

      const result = yield* readPullRequest("/fixture", 42).pipe(Effect.provide(ghLayer));

      expect(Option.isNone(result.pull)).toBe(true);
      expect(result.notices).toEqual([
        expect.objectContaining({
          code: "gh-unavailable",
          message: expect.stringContaining("did not match the requested fields"),
        }),
      ]);
    }),
  );

  it.effect("classifies GitHub claims and caps commit subjects from real Git", () =>
    Effect.gen(function* () {
      const repo = yield* pullFixture;
      const baseRefOid = execFileSync("git", ["rev-parse", "main"], {
        cwd: repo.dir,
        encoding: "utf8",
      }).trim();
      for (let index = 1; index <= PULL_COMMIT_SUBJECT_LIMIT + 2; index++) {
        repo.commitEmpty(`intent ${index}`);
      }
      const headRefOid = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: repo.dir,
        encoding: "utf8",
      }).trim();
      const linkedIssueUrl = "https://github.com/acme/planning/issues/14";
      const foreignLinkedIssueUrl = "https://github.com/otherowner/otherrepo/issues/1";
      const prFields =
        "url,state,author,baseRefName,headRefName,baseRefOid,headRefOid,commits,title,body,closingIssuesReferences";
      const ghLayer = commandLayerWithGh((args, cwd) => {
        if (args.join("\0") === ["pr", "view", "42", "--json", prFields].join("\0")) {
          return Effect.succeed(
            JSON.stringify({
              url: "https://github.com/acme/planning/pull/42",
              state: "OPEN",
              author: { login: "reviewer" },
              baseRefName: "main",
              headRefName: "feature/pool",
              baseRefOid,
              headRefOid,
              commits: Array.from({ length: PULL_COMMIT_SUBJECT_LIMIT + 3 }, () => ({})),
              title: "Honor the author's review intent",
              body: "Claims must be checked against the pinned implementation.",
              closingIssuesReferences: [
                { id: "issue-14", url: linkedIssueUrl },
                { id: "issue-1", url: foreignLinkedIssueUrl },
              ],
            }),
          );
        }
        if (
          args.join("\0") === ["issue", "view", linkedIssueUrl, "--json", "title,body"].join("\0")
        ) {
          return Effect.succeed(
            JSON.stringify({
              title: "Keep generation available without gh",
              body: "Commit subjects remain available from the local repository.",
            }),
          );
        }
        if (
          args.join("\0") ===
          ["issue", "view", foreignLinkedIssueUrl, "--json", "title,body"].join("\0")
        ) {
          return Effect.succeed(
            JSON.stringify({
              title: "Requirement owned by another repository",
              body: "This text remains useful context, but it is not author-stated intent.",
            }),
          );
        }
        return Effect.fail(
          new CommandFailed({
            file: "gh",
            args,
            cwd,
            stderr: "unexpected gh command",
            code: 1,
          }),
        );
      });

      const source = yield* resolvePullHead({
        cwd: repo.dir,
        target: { number: 42, slug: null },
      }).pipe(Effect.provide(ghLayer));
      const github = Option.getOrUndefined(source.claims.github);

      expect(github).toEqual({
        title: "Honor the author's review intent",
        body: "Claims must be checked against the pinned implementation.",
        linkedIssues: [
          {
            reference: { _tag: "SameRepositoryLinkedIssue", url: linkedIssueUrl },
            title: "Keep generation available without gh",
            body: Option.some("Commit subjects remain available from the local repository."),
          },
          {
            reference: {
              _tag: "ThirdPartyLinkedIssue",
              url: foreignLinkedIssueUrl,
              repository: "otherowner/otherrepo",
            },
            title: "Requirement owned by another repository",
            body: Option.some(
              "This text remains useful context, but it is not author-stated intent.",
            ),
          },
        ],
      });
      expect(source.claims.commitSubjects).toHaveLength(PULL_COMMIT_SUBJECT_LIMIT);
      expect(source.claims.commitSubjects[0]).toBe(`intent ${PULL_COMMIT_SUBJECT_LIMIT + 2}`);
      expect(source.claims.commitSubjects).not.toContain("feat: live planning pool items");
      expect(source.notices).toContainEqual({
        code: "third-party-linked-issue",
        message: `Linked issue ${foreignLinkedIssueUrl} comes from third-party repository otherowner/otherrepo.`,
        hint: "Its text remains available as an untrusted third-party claim, separate from author-stated intent.",
      });
      expect(source.notices).toHaveLength(1);
    }),
  );

  it.effect("keeps Git claims and the gh warning when GitHub is unavailable", () =>
    Effect.gen(function* () {
      const origin = yield* pullFixture;
      const clone = yield* Effect.acquireRelease(
        Effect.sync(() => cloneOnMain(origin, 42)),
        (value) => Effect.sync(() => value.cleanup()),
      );
      execFileSync("git", ["remote", "set-head", "origin", "main"], { cwd: clone.dir });
      execFileSync("git", ["fetch", "origin", "main"], { cwd: clone.dir });
      const fetchHead = readFileSync(join(clone.dir, ".git", "FETCH_HEAD"), "utf8");

      const source = yield* resolvePullHead({
        cwd: clone.dir,
        target: { number: 42, slug: null },
      }).pipe(Effect.provide(unavailableGhLayer));

      expect(source.pin).toBe(origin.pin);
      expect(Option.isNone(source.claims.github)).toBe(true);
      expect(source.claims.commitSubjects).toEqual(["feat: live planning pool items"]);
      expect(source.notices).toContainEqual(expect.objectContaining({ code: "gh-unavailable" }));
      expect(source.files.map((file) => file.path)).toContain("models/planning_pool_item.py");
      expect(readFileSync(join(clone.dir, ".git", "FETCH_HEAD"), "utf8")).toBe(fetchHead);
      expect(readFileSync(`${clone.dir}/models/planning_pool_item.py`, "utf8")).not.toContain(
        "_auto = False",
      );
    }),
  );
});
