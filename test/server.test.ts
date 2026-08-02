/**
 * Served mode: one pass over the real socket, plus the seams the HTTP test
 * cannot show — what a first write does to `.git/info/exclude`, and that the
 * payload cache spends the resolver once per key.
 */

import { Effect } from "effect";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LoadResult } from "../src/compile/load.js";
import type { IndexPayload, Payload, ReviewState } from "../src/payload/types.js";
import { payloadCache } from "../src/server/cache.js";
import { serve } from "../src/server/serve.js";
import { prepareSession, type Session } from "../src/server/session.js";
import { fileReviewStore, stateFileName } from "../src/state/store.js";
import { createFixtureRepo, type FixtureRepo } from "./support/repo.js";

/** A stand-in for the vite bundle: the static server only needs an entry file. */
function stubBundle(): string {
  const dir = mkdtempSync(join(tmpdir(), "balade-app-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>balade</title>\n", "utf8");
  return dir;
}

const json = { "content-type": "application/json" };

describe("the served API", () => {
  let repo: FixtureRepo;
  let appDir: string;
  let session: Session;
  let path: string;

  beforeAll(() => {
    repo = createFixtureRepo();
    repo.addWalkthrough("valid.md", "valid.md");
    appDir = stubBundle();

    const prepared = prepareSession({
      cwd: repo.dir,
      selection: { kind: "files", paths: [join(repo.dir, "walkthroughs/valid.md")] },
      useGh: false,
      warn: () => {},
    });
    if (prepared.kind !== "ready") throw new Error(`open refused to start: ${prepared.kind}`);
    session = prepared.session;
    path = session.paths[0] ?? "";
  });

  afterAll(() => {
    session.close();
    repo.cleanup();
    rmSync(appDir, { recursive: true, force: true });
  });

  it("names the walkthrough it serves, repo-relative", () => {
    expect(path).toBe("walkthroughs/valid.md");
    expect(session.outcome.ok).toBe(true);
  });

  it("threads --lang through to the payload, over meta.lang", () => {
    const french = prepareSession({
      cwd: repo.dir,
      selection: { kind: "files", paths: ["walkthroughs/valid.md"] },
      lang: "fr",
      useGh: false,
      warn: () => {},
    });
    if (french.kind !== "ready") throw new Error(`open refused to start: ${french.kind}`);
    const answer = french.session.api.walkthrough(null);
    french.session.close();
    if (answer.kind !== "json") throw new Error("expected a payload");
    /* The fixture frontmatter says `lang: en`; the flag wins. */
    expect((answer.body as Payload).lang).toBe("fr");
  });

  it("answers the payload, the review state and the staleness badge", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const url = yield* serve({ appDir, port: 0, api: session.api });
          expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
          yield* Effect.promise(() => exercise(url, path));
        }),
      ),
    );
  });
});

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

  beforeAll(() => {
    repo = createFixtureRepo();
    repo.addWalkthrough("valid.md", "valid.md");
    repo.addWalkthrough("second.md", "valid.md");

    const prepared = prepareSession({
      cwd: repo.dir,
      selection: { kind: "discovered" },
      useGh: false,
      warn: () => {},
    });
    if (prepared.kind !== "ready") throw new Error(`open refused to start: ${prepared.kind}`);
    session = prepared.session;
  });

  afterAll(() => {
    session.close();
    repo.cleanup();
  });

  it("answers the index on the bare endpoint when several are served", () => {
    const answer = session.api.walkthrough(null);
    if (answer.kind !== "json") throw new Error(`expected an index, got ${answer.kind}`);
    const index = answer.body as IndexPayload;
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
  });

  it("counts progress from the state file it finds", () => {
    const path = "walkthroughs/valid.md";
    const written = session.api.writeState(path, {
      version: 1,
      walkthrough: path,
      pr: 42,
      stamp: "0000000",
      sections: { overview: { hash: "sha256:aa", at: "2026-08-01T10:12:00.000Z" } },
      files: {},
    });
    expect(written.kind).toBe("json");

    const answer = session.api.walkthrough(null);
    if (answer.kind !== "json") throw new Error("expected an index");
    const entry = (answer.body as IndexPayload).entries.find((row) => row.path === path);
    expect(entry?.progress).toEqual({ done: 1, total: 8 });
  });

  it("needs a path for the per-file endpoints", () => {
    expect(session.api.readState(null)).toMatchObject({ kind: "error", status: 400 });
    expect(session.api.staleness(null)).toMatchObject({ kind: "error", status: 400 });
  });
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

  it("writes one file per walkthrough and excludes the directory once", () => {
    const warnings: string[] = [];
    const store = fileReviewStore({ repoRoot: repo.dir, warn: (m) => warnings.push(m) });

    store.write("walkthroughs/valid.md", state);
    expect(store.read("walkthroughs/valid.md")).toEqual(state);
    expect(stateFileName("walkthroughs/pr-96-loan-refactor.md")).toBe(
      "pr-96-loan-refactor.review.json",
    );

    const exclude = readFileSync(join(repo.dir, ".git/info/exclude"), "utf8");
    expect(exclude.split("\n").filter((line) => line.trim() === ".balade/")).toHaveLength(1);

    /* A second write must not add the line again. */
    store.write("walkthroughs/valid.md", state);
    const again = readFileSync(join(repo.dir, ".git/info/exclude"), "utf8");
    expect(again).toBe(exclude);
    expect(warnings).toEqual([]);
  });

  it("reads junk as absent and says so on stderr", () => {
    const warnings: string[] = [];
    const store = fileReviewStore({ repoRoot: repo.dir, warn: (m) => warnings.push(m) });
    writeFileSync(
      join(repo.dir, ".balade", stateFileName("walkthroughs/broken.md")),
      "{ not json",
      "utf8",
    );

    expect(store.read("walkthroughs/broken.md")).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("broken.review.json");
  });

  it("reads a schema-invalid state as absent and says so on stderr", () => {
    const warnings: string[] = [];
    const store = fileReviewStore({ repoRoot: repo.dir, warn: (m) => warnings.push(m) });
    writeFileSync(
      join(repo.dir, ".balade", stateFileName("walkthroughs/invalid.md")),
      JSON.stringify({
        ...state,
        walkthrough: "walkthroughs/invalid.md",
        sections: { overview: { hash: 7, at: "2026-08-01T10:12:00.000Z" } },
      }),
      "utf8",
    );

    expect(store.read("walkthroughs/invalid.md")).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("invalid.review.json");
  });

  it("ignores a file that names another walkthrough", () => {
    const store = fileReviewStore({ repoRoot: repo.dir, warn: () => {} });
    store.write("walkthroughs/valid.md", state);
    expect(store.read("docs/valid.md")).toBeNull();
  });
});

describe("the payload cache", () => {
  const result = (sourcePath: string): LoadResult => ({
    sourcePath,
    payload: null,
    diagnostics: [],
    ranges: [],
  });

  it("resolves once per key and again when the file or the head moves", () => {
    let loads = 0;
    let pin = "aaa";
    let head = "111";
    const cache = payloadCache({
      head: () => head,
      pin: () => pin,
      load: (sourcePath) => {
        loads += 1;
        return result(sourcePath);
      },
    });

    cache.get("w.md");
    cache.get("w.md");
    expect(loads).toBe(1);

    head = "222";
    cache.get("w.md");
    expect(loads).toBe(2);

    pin = "bbb";
    cache.get("w.md");
    expect(loads).toBe(3);

    /* What the watcher does when the file changes under a settled key. */
    cache.invalidate("w.md");
    cache.get("w.md");
    expect(loads).toBe(4);
  });
});
