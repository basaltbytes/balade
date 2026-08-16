/**
 * Served mode: one pass over the real socket, plus the seams the HTTP test
 * cannot show — what a first write does to `.git/info/exclude`, and that the
 * payload cache spends the resolver once per key.
 */

import { Effect, Layer, Option, Schema } from "effect";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest";
import type { LoadResult } from "../src/walkthrough/pipeline.js";
import type { IndexPayload, Payload, ReviewState } from "../src/contract/types.js";
import {
  ApiReviewStateUnavailable,
  ApiWalkthroughUnavailable,
  apiErrorResponse,
} from "../src/server/api.js";
import { PayloadCache } from "../src/server/cache.js";
import { ServerRepo } from "../src/server/repo.js";
import { reviewSessionStartedText, startReviewSession } from "../src/server/review.js";
import { findAppBundle, serve } from "../src/server/http.js";
import { prepareSession, type Session } from "../src/server/session.js";
import { gitCommonDir } from "../src/shell.js";
import { qaFilePath, ReviewStateStore, stateFilePath } from "../src/state.js";
import { provideLive } from "./support/effect.js";
import { addSubmodule, addWorktree, createFixtureRepo, type FixtureRepo } from "./support/repo.js";

/** A stand-in for the vite bundle: the static server only needs an entry file. */
function stubBundle(): string {
  const dir = mkdtempSync(join(tmpdir(), "balade-app-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>balade</title>\n", "utf8");
  return dir;
}

const json = { "content-type": "application/json" };

class ServerExerciseFailed extends Schema.TaggedErrorClass<ServerExerciseFailed>()(
  "ServerExerciseFailed",
  { cause: Schema.Defect() },
) {}

/** Promise APIs remain one interruptible, typed seam inside the Effect test. */
const serverPromise = <A>(run: (signal: AbortSignal) => PromiseLike<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new ServerExerciseFailed({ cause }),
  });

it.effect("keeps a missing served-app bundle in the error channel", () =>
  Effect.gen(function* () {
    expect((yield* Effect.flip(provideLive(findAppBundle())))._tag).toBe("AppBundleMissing");
  }),
);

it("keeps the served page on its own same-origin CSP and embeds its favicon", () => {
  const html = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
  const policy =
    "default-src 'none'; img-src data:; script-src 'self'; " +
    "style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'none'; " +
    "form-action 'none'; base-uri 'none'";
  const policyAt = html.indexOf('http-equiv="Content-Security-Policy"');

  expect(policyAt).toBeGreaterThan(-1);
  expect(html.indexOf(`content="${policy}"`, policyAt)).toBeGreaterThan(policyAt);
  expect(policyAt).toBeLessThan(html.indexOf('<script type="module"'));
  expect(html).toMatch(
    /<link\s+rel="icon"\s+type="image\/png"\s+sizes="64x64"\s+href="data:image\/png;base64,/u,
  );
});

it("keeps internal API failure causes out of public responses", () => {
  const secret = "/private/reviewer/repository/.balade/state.review.json";
  const errors = [
    new ApiWalkthroughUnavailable({
      path: "walkthroughs/valid.md",
      cause: new Error(`Could not read ${secret}`),
    }),
    new ApiReviewStateUnavailable({
      path: "walkthroughs/valid.md",
      cause: new Error(`Could not read ${secret}`),
    }),
  ];

  for (const error of errors) {
    const response = apiErrorResponse(error);
    expect(response.status).toBe(500);
    expect(response.message).not.toContain(secret);
  }
});

it("announces zero-target discovery before the server URL", () => {
  expect(
    reviewSessionStartedText({ kind: "discovered" }, ["a.md", "b.md"], "http://localhost/"),
  ).toBe(
    "No target given — serving 2 discovered walkthroughs.\n" +
      "balade is serving 2 walkthroughs at http://localhost/\n",
  );
  expect(reviewSessionStartedText({ kind: "discovered" }, ["a.md"], "http://localhost/")).toBe(
    "No target given — serving 1 discovered walkthrough.\n" +
      "balade is serving a.md at http://localhost/\n",
  );
});

it("warns only when a selection is read from a fetched pull head", () => {
  const paths = ["walkthroughs/review.md"];
  const serving = "balade is serving walkthroughs/review.md at http://localhost/\n";
  const remote = reviewSessionStartedText(
    {
      kind: "pullHead",
      root: "/repo",
      paths,
      number: 67,
      at: "0123456789abcdef0123456789abcdef01234567",
    },
    paths,
    "http://localhost/",
  );
  expect(remote).toBe(
    "Rendering walkthrough content from PR #67's head commit 0123456 — " +
      "content you have not reviewed.\n" +
      serving,
  );
  expect(
    reviewSessionStartedText(
      {
        kind: "workingTree",
        root: "/repo",
        paths,
      },
      paths,
      "http://localhost/",
    ),
  ).toBe(serving);
  expect(reviewSessionStartedText({ kind: "files", paths }, paths, "http://localhost/")).toBe(
    serving,
  );
});

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
      /* The fixture frontmatter says `lang: en`; the flag wins.
         SAFETY: one file is served, so the answer is the payload side. */
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

  it.effect("keeps review-state validation details in the typed error cause", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        session.api.writeState(path, JSON.stringify({ version: 2 })),
      );
      expect(error).toMatchObject({
        _tag: "ApiReviewStateInvalid",
        cause: { _tag: "ReviewStateInvalid" },
      });
    }),
  );

  it.live("answers the payload, the review state and the staleness badge", () =>
    Effect.scoped(
      provideLive(
        Effect.gen(function* () {
          const url = yield* serve({ appDir, port: 0, api: session.api });
          expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
          yield* serverPromise((signal) => exercise(url, path, signal));
        }),
      ),
    ),
  );

  it.live("prepares and serves a generated walkthrough as one review session", () =>
    Effect.scoped(
      provideLive(
        Effect.gen(function* () {
          const review = yield* startReviewSession({
            session: {
              cwd: repo.dir,
              selection: { kind: "files", paths: [join(repo.dir, "walkthroughs/valid.md")] },
              useGh: false,
            },
            appDir,
            port: 0,
          });
          expect(review._tag).toBe("ReviewSessionStarted");
          if (review._tag !== "ReviewSessionStarted") return;
          expect(review.session.paths).toEqual(["walkthroughs/valid.md"]);
          const page = yield* serverPromise(async (signal) =>
            (await fetch(`${review.url}/`, { signal })).text(),
          );
          expect(page).toContain("balade");
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

async function exercise(url: string, path: string, signal: AbortSignal): Promise<void> {
  const query = `?path=${encodeURIComponent(path)}`;
  const send = (route: string, init?: RequestInit) => fetch(`${url}${route}`, { ...init, signal });

  for (const [route, request] of [
    ["/", { kind: "read" }],
    ["/api/walkthrough", { kind: "read" }],
    ["/api/agent", { kind: "read" }],
    [`/api/state${query}`, { kind: "read" }],
    [`/api/state${query}`, { kind: "write", body: "{}" }],
    [`/api/qa${query}`, { kind: "read" }],
    [`/api/staleness${query}`, { kind: "read" }],
  ] satisfies ReadonlyArray<readonly [string, HostRequest]>) {
    expect(await statusWithHost(`${url}${route}`, "evil.com", request, signal)).toBe(403);
  }

  const port = new URL(url).port;
  for (const host of [`localhost:${port}`, `[::1]:${port}`]) {
    expect(await statusWithHost(`${url}/`, host, { kind: "read" }, signal)).toBe(200);
  }

  /* One walkthrough served: the bare endpoint is that walkthrough. */
  const answer = await send("/api/walkthrough");
  expect(answer.status).toBe(200);
  /* SAFETY: one file is served, so the endpoint answered the payload side. */
  const payload = (await answer.json()) as Payload;
  expect(payload.walkthrough).toBe(1);
  expect(payload.sourcePath).toBe(path);
  expect(payload.sections.map((section) => section.id)).toContain("overview");

  const qa = await send(`/api/qa${query}`);
  expect(qa.status).toBe(200);
  expect(await qa.json()).toMatchObject({
    version: 1,
    walkthrough: path,
    pr: payload.pr.number,
    stamp: payload.commit,
    threads: [],
  });

  const agent = await send("/api/agent");
  expect(agent.status).toBe(200);
  expect(await agent.json()).toEqual({ status: "setup-required" });

  const invalidQuestion = await send(`/api/qa${query}`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ kind: "new", question: "Missing anchor" }),
  });
  expect(invalidQuestion.status).toBe(400);

  const formQuestion = await send(`/api/qa${query}`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({
      kind: "new",
      anchor: { sectionId: "overview", excerpt: "selected" },
      question: "Cross-origin form?",
    }),
  });
  expect(formQuestion.status).toBe(400);

  const oversizedQuestion = await send(`/api/qa${query}`, {
    method: "POST",
    headers: json,
    body: "x".repeat(64 * 1024 + 1),
  });
  expect(oversizedQuestion.status).toBe(400);

  const unknown = await send("/api/walkthrough?path=walkthroughs/nope.md");
  expect(unknown.status).toBe(404);

  /* 404 means the CLI holds nothing — the browser copy answers instead. */
  expect((await send(`/api/state${query}`)).status).toBe(404);

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

  const put = await send(`/api/state${query}`, {
    method: "PUT",
    headers: json,
    body: JSON.stringify(state),
  });
  expect(put.status).toBe(200);

  const tooLarge = await send(`/api/state${query}`, {
    method: "PUT",
    headers: json,
    body: "x".repeat(4 * 1024 * 1024 + 1),
  });
  expect(tooLarge.status).toBe(400);

  const stored = await send(`/api/state${query}`);
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
    const refused = await send(`/api/state${query}`, { method: "PUT", headers: json, body });
    expect(refused.status).toBe(400);
  }

  /* Authority precedes the body: an unserved path answers 404 even when the
     body is not JSON. */
  const unservedPut = await send("/api/state?path=walkthroughs/nope.md", {
    method: "PUT",
    headers: json,
    body: "{ not json",
  });
  expect(unservedPut.status).toBe(404);

  const staleness = await send(`/api/staleness${query}`);
  expect(staleness.status).toBe(200);
  /* SAFETY: the assertion names the envelope the matcher below verifies. */
  expect((await staleness.json()) as { headDistance: unknown }).toEqual({
    headDistance: expect.any(Number),
  });

  /* The SPA sits under the API and still answers the root. */
  const spa = await send("/");
  expect(spa.status).toBe(200);
  expect(spa.headers.get("x-frame-options")).toBe("DENY");
  expect(await spa.text()).toContain("balade");
}

type HostRequest = { kind: "read" } | { kind: "write"; body: string };

function statusWithHost(
  url: string,
  host: string,
  request: HostRequest,
  signal: AbortSignal,
): Promise<number> {
  const details =
    request.kind === "read"
      ? { method: "GET", headers: { host }, body: undefined }
      : {
          method: "PUT",
          headers: {
            host,
            "content-length": Buffer.byteLength(request.body),
            "content-type": "application/json",
          },
          body: request.body,
        };

  return new Promise((resolve, reject) => {
    const connection = httpRequest(
      url,
      {
        method: details.method,
        headers: details.headers,
        signal,
      },
      (response) => {
        response.on("error", reject);
        response.resume();
        response.on("end", () => {
          const status = response.statusCode;
          if (status === undefined) {
            reject(new Error(`No HTTP status received from ${url}`));
          } else {
            resolve(status);
          }
        });
      },
    );
    connection.on("error", reject);
    connection.end(details.body);
  });
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
      /* SAFETY: several files are served, so the bare endpoint answers the index. */
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
      const written = yield* session.api.writeState(
        path,
        JSON.stringify({
          version: 1,
          walkthrough: path,
          pr: 42,
          stamp: "0000000",
          sections: { overview: { hash: "sha256:aa", at: "2026-08-01T10:12:00.000Z" } },
          files: {},
        }),
      );
      expect(written.walkthrough).toBe(path);

      /* SAFETY: several files are served, so the bare endpoint answers the index. */
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
        join(repo.dir, ".balade", stateFilePath("walkthroughs/second.md")),
        "{ not json",
        "utf8",
      );
      const error = yield* Effect.flip(session.api.walkthrough(null));
      expect(error).toMatchObject({
        _tag: "ApiReviewStateUnavailable",
        path: "walkthroughs/second.md",
        cause: { _tag: "StateInvalid" },
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

  /** A store rooted in the plain fixture clone, where `.git` is a directory. */
  const storeLayer = () =>
    ReviewStateStore.layer({ repoRoot: repo.dir, gitCommonDir: join(repo.dir, ".git") });

  const state: ReviewState = {
    version: 1,
    walkthrough: "walkthroughs/valid.md",
    pr: 42,
    stamp: "9f3c2ad",
    sections: { overview: { hash: "sha256:aa", at: "2026-08-01T10:12:00.000Z" } },
    files: {},
  };

  /** One state write through a store rooted at `repoRoot`, excluding into `gitDir`. */
  const writeStateAt = (repoRoot: string, gitDir: string) =>
    Effect.gen(function* () {
      const store = yield* ReviewStateStore;
      yield* store.write("walkthroughs/valid.md", state);
    }).pipe(Effect.provide(ReviewStateStore.layer({ repoRoot, gitCommonDir: gitDir })));

  /** What git itself answers from `dir` — the proof the exclude line exists for. */
  const checkIgnore = (dir: string): string =>
    execFileSync("git", ["check-ignore", ".balade"], { cwd: dir, encoding: "utf8" }).trim();

  it.effect("writes one file per walkthrough and excludes the directory once", () =>
    Effect.gen(function* () {
      const store = yield* ReviewStateStore;

      yield* store.write("walkthroughs/valid.md", state);
      const stored = yield* store.read("walkthroughs/valid.md");
      expect(Option.isSome(stored) ? stored.value : undefined).toEqual(state);
      expect(stateFilePath("walkthroughs/pr-96-loan-refactor.md")).toBe(
        "walkthroughs/pr-96-loan-refactor.md.review.json",
      );
      expect(qaFilePath("walkthroughs/pr-96-loan-refactor.md")).toBe(
        "walkthroughs/pr-96-loan-refactor.md.qa.json",
      );
      expect(stateFilePath("walkthroughs/review")).not.toBe(
        stateFilePath("walkthroughs/review.md"),
      );

      const exclude = readFileSync(join(repo.dir, ".git/info/exclude"), "utf8");
      expect(exclude.split("\n").filter((line) => line.trim() === ".balade/")).toHaveLength(1);

      /* A second write must not add the line again. */
      yield* store.write("walkthroughs/valid.md", state);
      const again = readFileSync(join(repo.dir, ".git/info/exclude"), "utf8");
      expect(again).toBe(exclude);
    }).pipe(Effect.provide(storeLayer()), provideLive),
  );

  it.effect("keeps same-basename walkthrough sidecars independent", () =>
    Effect.gen(function* () {
      const store = yield* ReviewStateStore;
      const first = { ...state, walkthrough: "walkthroughs/one/review.md" };
      const second = { ...state, walkthrough: "docs/two/review.md" };

      yield* store.write(first.walkthrough, first);
      yield* store.write(second.walkthrough, second);

      const storedFirst = yield* store.read(first.walkthrough);
      const storedSecond = yield* store.read(second.walkthrough);
      expect(Option.isSome(storedFirst) ? storedFirst.value : undefined).toEqual(first);
      expect(Option.isSome(storedSecond) ? storedSecond.value : undefined).toEqual(second);
      expect(stateFilePath(first.walkthrough)).not.toBe(stateFilePath(second.walkthrough));
      expect(qaFilePath(first.walkthrough)).not.toBe(qaFilePath(second.walkthrough));
    }).pipe(Effect.provide(storeLayer()), provideLive),
  );

  it.effect("rejects a sidecar path outside the repository state directory", () =>
    Effect.gen(function* () {
      const store = yield* ReviewStateStore;
      const sourcePath = "../escaped.md";
      const rejectedRead = yield* store.read(sourcePath).pipe(Effect.flip);
      const rejectedWrite = yield* store
        .write(sourcePath, { ...state, walkthrough: sourcePath })
        .pipe(Effect.flip);

      expect(rejectedRead).toMatchObject({ _tag: "StatePathRejected", path: sourcePath });
      expect(rejectedWrite).toMatchObject({ _tag: "StatePathRejected", path: sourcePath });
      expect(existsSync(join(repo.dir, "escaped.md.review.json"))).toBe(false);
    }).pipe(Effect.provide(storeLayer()), provideLive),
  );

  it.effect("returns a typed error for corrupt JSON", () =>
    Effect.gen(function* () {
      const store = yield* ReviewStateStore;
      const file = join(repo.dir, ".balade", stateFilePath("walkthroughs/broken.md"));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, "{ not json", "utf8");

      const error = yield* Effect.flip(store.read("walkthroughs/broken.md"));
      expect(error).toMatchObject({ _tag: "StateInvalid" });
      expect(error.path).toContain("broken.md.review.json");
    }).pipe(Effect.provide(storeLayer()), provideLive),
  );

  it.effect("returns a typed error for schema-invalid state", () =>
    Effect.gen(function* () {
      const store = yield* ReviewStateStore;
      const file = join(repo.dir, ".balade", stateFilePath("walkthroughs/invalid.md"));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(
        file,
        JSON.stringify({
          ...state,
          walkthrough: "walkthroughs/invalid.md",
          sections: { overview: { hash: 7, at: "2026-08-01T10:12:00.000Z" } },
        }),
        "utf8",
      );

      const error = yield* Effect.flip(store.read("walkthroughs/invalid.md"));
      expect(error).toMatchObject({ _tag: "StateInvalid" });
      expect(error.path).toContain("invalid.md.review.json");
    }).pipe(Effect.provide(storeLayer()), provideLive),
  );

  it.effect("ignores a file that names another walkthrough", () =>
    Effect.gen(function* () {
      const store = yield* ReviewStateStore;
      yield* store.write("walkthroughs/valid.md", state);
      expect(yield* store.read("docs/valid.md")).toMatchObject({ _tag: "None" });
    }).pipe(Effect.provide(storeLayer()), provideLive),
  );

  it.effect("excludes through the shared git directory from a linked worktree", () =>
    Effect.gen(function* () {
      const origin = createFixtureRepo();
      const worktree = addWorktree(origin, "main");
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          worktree.cleanup();
          origin.cleanup();
        }),
      );

      /* `.git` at the worktree root is a pointer file; the helper resolves past it. */
      const commonDir = yield* gitCommonDir(worktree.dir);
      yield* writeStateAt(worktree.dir, commonDir);

      /* The line lands in the shared exclude, and git in the worktree honours it. */
      const exclude = readFileSync(join(origin.dir, ".git/info/exclude"), "utf8");
      expect(exclude.split("\n")).toContain(".balade/");
      expect(checkIgnore(worktree.dir)).toBe(".balade");
    }).pipe(provideLive),
  );

  it.effect("rejects a sidecar parent redirected through a symbolic link", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const isolated = createFixtureRepo();
        const outside = mkdtempSync(join(tmpdir(), "balade-sidecar-outside-"));
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            isolated.cleanup();
            rmSync(outside, { recursive: true, force: true });
          }),
        );
        mkdirSync(join(isolated.dir, ".balade"));
        symlinkSync(
          outside,
          join(isolated.dir, ".balade", "walkthroughs"),
          process.platform === "win32" ? "junction" : "dir",
        );
        const store = yield* ReviewStateStore.pipe(
          Effect.provide(
            ReviewStateStore.layer({
              repoRoot: isolated.dir,
              gitCommonDir: join(isolated.dir, ".git"),
            }),
          ),
        );

        const error = yield* store.write("walkthroughs/valid.md", state).pipe(Effect.flip);

        expect(error).toMatchObject({ _tag: "StatePathRejected", path: "walkthroughs/valid.md" });
        expect(existsSync(join(outside, "valid.md.review.json"))).toBe(false);
      }).pipe(provideLive),
    ),
  );

  it.effect("excludes through the module git directory from a submodule", () =>
    Effect.gen(function* () {
      const origin = createFixtureRepo();
      const submodule = addSubmodule(origin);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          submodule.cleanup();
          origin.cleanup();
        }),
      );

      /* The pointer file resolves into the host's `.git/modules/` store. */
      const commonDir = yield* gitCommonDir(submodule.dir);
      expect(commonDir).toContain(join(".git", "modules"));
      yield* writeStateAt(submodule.dir, commonDir);

      expect(readFileSync(join(commonDir, "info/exclude"), "utf8").split("\n")).toContain(
        ".balade/",
      );
      expect(checkIgnore(submodule.dir)).toBe(".balade");
    }).pipe(provideLive),
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
      source: () => Effect.succeed(""),
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
