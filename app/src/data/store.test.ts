/* The two stores, driven through their own seams: a memory storage and a fake
   fetch, no module mocking. The shared parse is covered in `test/parse-review.test.ts`. */

import { describe, expect, it } from "vitest";
import type { ReviewState } from "../contract";
import { httpStore, localStore, type FetchLike, type StorageLike } from "./store";

const KEY = "balade:acme/repo#42:walkthroughs/one.md";

const state: ReviewState = {
  version: 1,
  walkthrough: "walkthroughs/one.md",
  pr: 42,
  stamp: "9f3c2ad",
  sections: { intro: { hash: "sha256:aa", at: "2026-01-01T09:00:00.000Z" } },
  files: { "intro//models/pool.py": { hash: "sha256:bb", at: "2026-01-01T09:01:00.000Z" } },
};

function memoryStorage(seed: Record<string, string> = {}): StorageLike & {
  entries: Map<string, string>;
} {
  const entries = new Map(Object.entries(seed));
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}

/** Private mode, or a full quota. */
const refusingStorage: StorageLike = {
  getItem: () => null,
  setItem: () => {
    throw new Error("quota exceeded");
  },
};

const answering =
  (status: number, body = ""): FetchLike =>
  () =>
    Promise.resolve(new Response(body, { status }));

describe("the browser store", () => {
  it("reads its copy back through the parser", async () => {
    const storage = memoryStorage({ [KEY]: JSON.stringify(state) });
    expect(await localStore(KEY, storage).load()).toEqual(state);
  });

  it("answers null on a copy it cannot read", async () => {
    const storage = memoryStorage({ [KEY]: "{ not json" });
    expect(await localStore(KEY, storage).load()).toBeNull();
  });

  it("names a write the browser refused", async () => {
    expect(await localStore(KEY, refusingStorage).save(state)).toBe("failed");
  });
});

describe("the served store", () => {
  const withFetch = (fetch: FetchLike, storage: StorageLike) =>
    httpStore("walkthroughs/one.md", localStore(KEY, storage), fetch);

  it("consults the browser copy when the CLI holds nothing", async () => {
    const storage = memoryStorage({ [KEY]: JSON.stringify(state) });
    /* Marks made while the CLI was down must survive its 404. */
    expect(await withFetch(answering(404), storage).load()).toEqual(state);
  });

  it("takes the CLI answer when there is one", async () => {
    const storage = memoryStorage();
    const store = withFetch(answering(200, JSON.stringify(state)), storage);
    expect(await store.load()).toEqual(state);
  });

  it("reports a failed PUT and keeps the marks in the browser", async () => {
    const storage = memoryStorage();
    const store = withFetch(answering(503), storage);
    expect(await store.save(state)).toBe("fallback");
    expect(JSON.parse(storage.entries.get(KEY) ?? "null")).toEqual(state);
  });

  it("reports a write that reached nothing at all", async () => {
    const store = withFetch(() => Promise.reject(new Error("offline")), refusingStorage);
    expect(await store.save(state)).toBe("failed");
  });

  it("says so when the PUT went through", async () => {
    const calls: string[] = [];
    const fetch: FetchLike = (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return Promise.resolve(new Response("", { status: 200 }));
    };
    expect(await withFetch(fetch, memoryStorage()).save(state)).toBe("saved");
    expect(calls).toEqual(["PUT /api/state?path=walkthroughs%2Fone.md"]);
  });
});
