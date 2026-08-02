/**
 * Served mode: one pass over the real socket, plus the seams the HTTP test
 * cannot show — what a first write does to `.git/info/exclude`, and that the
 * payload cache spends the resolver once per key.
 */

import { Effect, Layer, Option } from "effect";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest";
import type { LoadResult } from "../src/compile/load.js";
import type { IndexPayload, Payload, ReviewState } from "../src/payload/types.js";
import { PayloadCache } from "../src/server/cache.js";
import { ServerRepo } from "../src/server/repo.js";
import { findAppBundle, serve } from "../src/server/serve.js";
import { prepareSession, type Session } from "../src/server/session.js";
import { ReviewStateStore, stateFileName } from "../src/state/store.js";
import { provideLive } from "./support/effect.js";
import { createFixtureRepo, type FixtureRepo } from "./support/repo.js";

/** A stand-in for the vite bundle: the static server only needs an entry file. */
function stubBundle(): string {
  const dir = mkdtempSync(join(tmpdir(), "balade-app-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>balade</title>\n", "utf8");
  return dir;
}

const json = { "content-type": "application/json" };

it.effect("keeps a missing served-app bundle in the error channel", () =>
  Effect.gen(function* () {
    expect((yield* Effect.flip(provideLive(findAppBundle())))._tag).toBe("AppBundleMissing");
  }),
);

describe("the served API", () => {
  let repo: FixtureRepo;
  let appDir: string;
  let session: Session;
  let path: string;

  beforeAll(async () => {
    repo = createFixtureRepo();
    repo.addWalkthrough("valid.md", "valid.md");
    appDir = stubBundle();

    const prepared = await Effect.runPromise(
      provideLive(
        Effect.scoped(
          prepareSession({
            cwd: repo.dir,
            selection: { kind: "files", paths: [join(repo.dir, "walkthroughs/valid.md")] },
            useGh: false,
          }),
        ),
      ),
    );
    if (prepared._tag !== "SessionReady") {
      throw new Error(`open refused to start: ${prepared._tag}`);
    }
    session = prepared.session;
    path = session.paths[0] ?? "";
  });

  afterAll(() => {
    repo.cleanup();
    rmSync(appDir, { recursive: true, force: true });
  });

  it("names the walkthrough it serves, repo-relative", () => {
    expect(path).toBe("walkthroughs/valid.md");
    expect(session.reports).toHaveLength(1);
  });

  it.effect("threads --lang through to the payload, over meta.lang", () =>
    Effect.gen(function* () {
      const french = yield* provideLive(
        prepareSession({
          cwd: repo.dir,
          selection: { kind: "files", paths: ["walkthroughs/valid.md"] },
          lang: "fr",
          useGh: false,
        }),
      );
      if (french._tag !== "SessionReady") {
        throw new Error(`open refused to start: ${french._tag}`);
      }
      const answer = yield* french.session.api.walkthrough(null);
      /* The fixture frontmatter says `lang: en`; the flag wins. */
      expect((answer as Payload).lang).toBe("fr");
    }),
  );

  it.effect("tags empty and unbuildable session outcomes", () =>
    Effect.gen(function* () {
      const empty = yield* provideLive(
        prepareSession({
          cwd: repo.dir,
          selection: { kind: "files", paths: [] },
          useGh: false,
        }),
      );
      expect(empty).toMatchObject({ _tag: "SessionNotStarted" });

      repo.write("walkthroughs/invalid.md", "# Missing frontmatter\n");
      const failed = yield* provideLive(
        prepareSession({
          cwd: repo.dir,
          selection: { kind: "files", paths: ["walkthroughs/invalid.md"] },
          useGh: false,
        }),
      );
      expect(failed).toMatchObject({
        _tag: "SessionFailed",
        reports: [{ ok: false }],
      });
    }),
  );

  it.live("answers the payload, the review state and the staleness badge", () =>
    Effect.scoped(
      provideLive(
        Effect.gen(function* () {
          const url = yield* serve({ appDir, port: 0, api: session.api });
          expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
          yield* Effect.promise(() => exercise(url, path));
        }),
      ),
    ),
  );
});

it.live("invalidates a cached payload when the scoped watcher sees an edit", () =>
  provideLive(
    Effect.gen(function* () {
      const repo = createFixtureRepo();
      repo.addWalkthrough("valid.md", "valid.md");
      yield* Effect.addFinalizer(() => Effect.sync(() => repo.cleanup()));

      const prepared = yield* prepareSession({
        cwd: repo.dir,
        selection: { kind: "files", paths: ["walkthroughs/valid.md"] },
        useGh: false,
      });
      if (prepared._tag !== "SessionReady") {
        throw new Error(`open refused to start: ${prepared._tag}`);
      }

      const file = join(repo.dir, "walkthroughs/valid.md");
      const before = yield* prepared.session.api.walkthrough(null);
      if ("kind" in before) throw new Error("single walkthrough returned an index");
      expect(before.title).toBe("Add live planning pool items");

      /* Let the scoped watcher acquire before making the edit. The stamp and
         HEAD do not move, so only watcher invalidation can refresh this key. */
      yield* Effect.sleep("20 millis");
      writeFileSync(
        file,
        readFileSync(file, "utf8").replace(
          "Add live planning pool items",
          "Add watched planning pool items",
        ),
        "utf8",
      );

      let title = before.title;
      for (let attempt = 0; attempt < 50 && title === before.title; attempt += 1) {
        yield* Effect.sleep("20 millis");
        const refreshed = yield* prepared.session.api.walkthrough(null);
        if ("kind" in refreshed) throw new Error("single walkthrough returned an index");
        title = refreshed.title;
      }
      expect(title).toBe("Add watched planning pool items");
    }),
  ),
);

async function exercise(url: string, path: string): Promise<void> {
  const query = `?path=${encodeURIComponent(path)}`;

  /* One walkthrough served: the bare endpoint is that walkthrough. */
  const answer = await fetch(`${url}/api/walkthrough`);
  expect(answer.status).toBe(200);
  const payload = (await answer.json()) as Payload;
  expect(payload.walkthrough).toBe(1);
  expect(payload.sourcePath).toBe(path);
  expect(payload.sections.map((section) => section.id)).toContain("overview");

  const unknown = await fetch(`${url}/api/walkthrough?path=walkthroughs/nope.md`);
  expect(unknown.status).toBe(404);

  /* 404 means the CLI holds nothing — the browser copy answers instead. */
  expect((await fetch(`${url}/api/state${query}`)).status).toBe(404);

  const first = payload.sections[0];
  if (first === undefined) throw new Error("the fixture payload has no section");
  const state: ReviewState = {
    version: 1,
    walkthrough: path,
    pr: payload.pr.number,
    stamp: payload.commit,
    sections: { [first.id]: { hash: first.hash, at: "2026-08-01T10:12:00.000Z" } },
    files: {},
  };

  const put = await fetch(`${url}/api/state${query}`, {
    method: "PUT",
    headers: json,
    body: JSON.stringify(state),
  });
  expect(put.status).toBe(200);

  const stored = await fetch(`${url}/api/state${query}`);
  expect(stored.status).toBe(200);
  expect(await stored.json()).toEqual(state);

  for (const body of [
    "{ not json",
    JSON.stringify({ version: 2 }),
    JSON.stringify({ ...state, walkthrough: "other.md" }),
    JSON.stringify({
      ...state,
      sections: { overview: { hash: 7, at: "2026-08-01T10:12:00.000Z" } },
    }),
  ]) {
    const refused = await fetch(`${url}/api/state${query}`, { method: "PUT", headers: json, body });
    expect(refused.status).toBe(400);
  }

  const staleness = await fetch(`${url}/api/staleness${query}`);
  expect(staleness.status).toBe(200);
  expect((await staleness.json()) as { headDistance: unknown }).toEqual({
    headDistance: expect.any(Number),
  });

  /* The SPA sits under the API and still answers the root. */
  const spa = await fetch(`${url}/`);
  expect(spa.status).toBe(200);
  expect(await spa.text()).toContain("balade");
}

describe("the index", () => {
  let repo: FixtureRepo;
  let session: Session;

  beforeAll(async () => {
    repo = createFixtureRepo();
    repo.addWalkthrough("valid.md", "valid.md");
    repo.addWalkthrough("second.md", "valid.md");

    const prepared = await Effect.runPromise(
      provideLive(
        Effect.scoped(
          prepareSession({
            cwd: repo.dir,
            selection: { kind: "discovered" },
            useGh: false,
          }),
        ),
      ),
    );
    if (prepared._tag !== "SessionReady") {
      throw new Error(`open refused to start: ${prepared._tag}`);
    }
    session = prepared.session;
  });

  afterAll(() => {
    repo.cleanup();
  });

  it.effect("answers the index on the bare endpoint when several are served", () =>
    Effect.gen(function* () {
      const index = (yield* session.api.walkthrough(null)) as IndexPayload;
      expect(index.kind).toBe("index");
      expect(index.entries.map((entry) => entry.path)).toEqual([
        "walkthroughs/second.md",
        "walkthroughs/valid.md",
      ]);
      const first = index.entries[0];
      expect(first?.title).toBe("Add live planning pool items");
      expect(first?.pr).toBe(42);
      expect(first?.meta).toEqual({ module: "acme_planning", lang: "en" });
      expect(first?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      /* Never opened: no state file, so no progress. */
      expect(first?.progress).toBeUndefined();
    }),
  );

  it.effect("counts progress from the state file it finds", () =>
    Effect.gen(function* () {
      const path = "walkthroughs/valid.md";
      const written = yield* session.api.writeState(path, {
        version: 1,
        walkthrough: path,
        pr: 42,
        stamp: "0000000",
        sections: { overview: { hash: "sha256:aa", at: "2026-08-01T10:12:00.000Z" } },
        files: {},
      });
      expect(written.walkthrough).toBe(path);

      const answer = (yield* session.api.walkthrough(null)) as IndexPayload;
      const entry = answer.entries.find((row) => row.path === path);
      expect(entry?.progress).toEqual({ done: 1, total: 8 });
    }),
  );

  it.effect("needs a path for the per-file endpoints", () =>
    Effect.gen(function* () {
      expect((yield* Effect.flip(session.api.readState(null)))._tag).toBe("ApiPathRequired");
      expect((yield* Effect.flip(session.api.staleness(null)))._tag).toBe("ApiPathRequired");
    }),
  );

  it.effect("keeps an unreadable index state in the API error channel", () =>
    Effect.gen(function* () {
      writeFileSync(
        join(repo.dir, ".balade", stateFileName("walkthroughs/second.md")),
        "{ not json",
        "utf8",
      );
      const error = yield* Effect.flip(session.api.walkthrough(null));
      expect(error).toMatchObject({
        _tag: "ApiReviewStateUnavailable",
        path: "walkthroughs/second.md",
      });
    }),
  );
});

describe("review-state files", () => {
  let repo: FixtureRepo;

  beforeAll(() => {
    repo = createFixtureRepo();
  });
  afterAll(() => repo.cleanup());

  const state: ReviewState = {
    version: 1,
    walkthrough: "walkthroughs/valid.md",
    pr: 42,
    stamp: "9f3c2ad",
    sections: { overview: { hash: "sha256:aa", at: "2026-08-01T10:12:00.000Z" } },
    files: {},
  };

  it.effect("writes one file per walkthrough and excludes the directory once", () =>
    Effect.gen(function* () {
      const store = yield* ReviewStateStore;

      yield* store.write("walkthroughs/valid.md", state);
      const stored = yield* store.read("walkthroughs/valid.md");
      expect(Option.isSome(stored) ? stored.value : undefined).toEqual(state);
      expect(stateFileName("walkthroughs/pr-96-loan-refactor.md")).toBe(
        "pr-96-loan-refactor.review.json",
      );

      const exclude = readFileSync(join(repo.dir, ".git/info/exclude"), "utf8");
      expect(exclude.split("\n").filter((line) => line.trim() === ".balade/")).toHaveLength(1);

      /* A second write must not add the line again. */
      yield* store.write("walkthroughs/valid.md", state);
      const again = readFileSync(join(repo.dir, ".git/info/exclude"), "utf8");
      expect(again).toBe(exclude);
    }).pipe(Effect.provide(ReviewStateStore.layer({ repoRoot: repo.dir })), provideLive),
  );

  it.effect("returns a typed error for corrupt JSON", () =>
    Effect.gen(function* () {
      const store = yield* ReviewStateStore;
      writeFileSync(
        join(repo.dir, ".balade", stateFileName("walkthroughs/broken.md")),
        "{ not json",
        "utf8",
      );

      const error = yield* Effect.flip(store.read("walkthroughs/broken.md"));
      expect(error).toMatchObject({ _tag: "StateInvalid" });
      expect(error.path).toContain("broken.review.json");
    }).pipe(Effect.provide(ReviewStateStore.layer({ repoRoot: repo.dir })), provideLive),
  );

  it.effect("returns a typed error for schema-invalid state", () =>
    Effect.gen(function* () {
      const store = yield* ReviewStateStore;
      writeFileSync(
        join(repo.dir, ".balade", stateFileName("walkthroughs/invalid.md")),
        JSON.stringify({
          ...state,
          walkthrough: "walkthroughs/invalid.md",
          sections: { overview: { hash: 7, at: "2026-08-01T10:12:00.000Z" } },
        }),
        "utf8",
      );

      const error = yield* Effect.flip(store.read("walkthroughs/invalid.md"));
      expect(error).toMatchObject({ _tag: "StateInvalid" });
      expect(error.path).toContain("invalid.review.json");
    }).pipe(Effect.provide(ReviewStateStore.layer({ repoRoot: repo.dir })), provideLive),
  );

  it.effect("ignores a file that names another walkthrough", () =>
    Effect.gen(function* () {
      const store = yield* ReviewStateStore;
      yield* store.write("walkthroughs/valid.md", state);
      expect(yield* store.read("docs/valid.md")).toMatchObject({ _tag: "None" });
    }).pipe(Effect.provide(ReviewStateStore.layer({ repoRoot: repo.dir })), provideLive),
  );
});

describe("the payload cache", () => {
  const result = (sourcePath: string): LoadResult => ({
    sourcePath,
    payload: null,
    diagnostics: [],
    ranges: [],
  });

  it.effect("resolves once per key and again when the file or the head moves", () => {
    let loads = 0;
    let pin = "aaa";
    let head = "111";
    const repoLayer = Layer.succeed(ServerRepo, {
      root: "/fixture",
      slug: "fixture/repo",
      head: Effect.sync(() => head),
      pin: () => Effect.succeed(Option.some(pin)),
      distance: () => Effect.succeed(Option.none()),
      row: () => Effect.succeed(Option.none()),
      load: (sourcePath) =>
        Effect.sync(() => {
          loads += 1;
          return result(sourcePath);
        }),
    });

    return Effect.gen(function* () {
      const cache = yield* PayloadCache;

      yield* cache.get("w.md");
      yield* cache.get("w.md");
      expect(loads).toBe(1);

      head = "222";
      yield* cache.get("w.md");
      expect(loads).toBe(2);

      pin = "bbb";
      yield* cache.get("w.md");
      expect(loads).toBe(3);

      /* What the watcher does when the file changes under a settled key. */
      yield* cache.invalidate("w.md");
      yield* cache.get("w.md");
      expect(loads).toBe(4);
    }).pipe(Effect.provide(PayloadCache.layer.pipe(Layer.provide(repoLayer))));
  });
});
