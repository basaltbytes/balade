// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntry, ReviewState } from "../contract";
import type { FetchLike } from "../data/browser";
import type { ReviewStoreTarget } from "../data/store";
import { pr96 } from "../fixtures/pr96";
import { useReviewApi } from "./review-context";

const firstReviewableFile = (): FileEntry => {
  const file = pr96.files[0];
  if (file === undefined) throw new Error("the fixture needs a reviewable file");
  return file;
};

const reviewedFile = firstReviewableFile();

const payload = {
  ...pr96,
  files: [reviewedFile],
  nav: [],
  sections: pr96.sections.slice(0, 2),
  errors: [],
};

const target = {
  mode: "served",
  storageKey: payload.storageKey,
  sourcePath: payload.sourcePath,
} satisfies ReviewStoreTarget;

const stored: ReviewState = {
  version: 1,
  walkthrough: payload.sourcePath,
  pr: payload.pr.number,
  stamp: payload.commit,
  sections: {
    overview: { hash: "sha256:sec-overview-1", at: "2026-01-01T09:00:00.000Z" },
  },
  files: {
    [`overview//${reviewedFile.path}`]: {
      hash: reviewedFile.hash,
      at: "2026-01-01T09:01:00.000Z",
    },
  },
};

interface Deferred<A> {
  readonly promise: Promise<A>;
  readonly resolve: (value: A) => void;
}

function deferred<A>(): Deferred<A> {
  let resolve: ((value: A) => void) | undefined;
  const promise = new Promise<A>((done) => {
    resolve = done;
  });
  return {
    promise,
    resolve: (value) => {
      if (resolve === undefined) throw new Error("deferred resolver was not installed");
      resolve(value);
    },
  };
}

function Probe() {
  const review = useReviewApi(payload, target);
  return (
    <>
      <output data-testid="ready">{String(review.ready)}</output>
      <output data-testid="sections">{Object.keys(review.state.sections).sort().join(",")}</output>
      <output data-testid="files">{Object.keys(review.state.files).sort().join(",")}</output>
      <button type="button" disabled={!review.ready} onClick={() => review.markSection("overview")}>
        overview
      </button>
      <button
        type="button"
        disabled={!review.ready}
        onClick={() => review.markSection("mental-model")}
      >
        mental model
      </button>
      <button
        type="button"
        disabled={!review.ready}
        onClick={() => review.markFile("overview", reviewedFile.path)}
      >
        reviewed file
      </button>
    </>
  );
}

const button = (container: HTMLElement, label: string): HTMLButtonElement => {
  const match = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
};

const installFetch = (fetch: FetchLike): void => {
  Object.defineProperty(window, "fetch", { configurable: true, writable: true, value: fetch });
};

describe("the browser review lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it("keeps review controls read-only until stored state arrives", async () => {
    const loaded = deferred<Response>();
    const putBodies: ReviewState[] = [];
    const fetch: FetchLike = (_url, init) => {
      if (init?.method === "PUT") {
        putBodies.push(JSON.parse(String(init.body)) as ReviewState);
        return Promise.resolve(new Response("", { status: 200 }));
      }
      return loaded.promise;
    };
    installFetch(fetch);

    await act(async () => root.render(<Probe />));
    expect(button(container, "mental model").disabled).toBe(true);
    await act(async () => button(container, "mental model").click());
    expect(container.querySelector('[data-testid="sections"]')?.textContent).toBe("");
    expect(container.querySelector('[data-testid="files"]')?.textContent).toBe("");

    loaded.resolve(Response.json(stored));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector('[data-testid="ready"]')?.textContent).toBe("true");
    expect(container.querySelector('[data-testid="sections"]')?.textContent).toBe("overview");
    expect(container.querySelector('[data-testid="files"]')?.textContent).toBe(
      `overview//${reviewedFile.path}`,
    );
    expect(button(container, "mental model").disabled).toBe(false);
    expect(putBodies).toHaveLength(0);
  });

  it("serializes review writes in state order", async () => {
    const firstWrite = deferred<Response>();
    const putBodies: ReviewState[] = [];
    const fetch: FetchLike = (_url, init) => {
      if (init?.method !== "PUT") return Promise.resolve(new Response("", { status: 404 }));
      putBodies.push(JSON.parse(String(init.body)) as ReviewState);
      return putBodies.length === 1
        ? firstWrite.promise
        : Promise.resolve(new Response("", { status: 200 }));
    };
    installFetch(fetch);

    await act(async () => root.render(<Probe />));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(button(container, "overview").disabled).toBe(false);
    await act(async () => button(container, "overview").click());
    await vi.waitFor(() => expect(putBodies).toHaveLength(1));
    await act(async () => button(container, "mental model").click());
    await Promise.resolve();
    expect(putBodies).toHaveLength(1);

    await act(async () => {
      firstWrite.resolve(new Response("", { status: 200 }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(putBodies).toHaveLength(2);
    expect(Object.keys(putBodies[0]?.sections ?? {})).toEqual(["overview"]);
    expect(Object.keys(putBodies[1]?.sections ?? {}).sort()).toEqual(["mental-model", "overview"]);
  });

  it("aborts an in-flight load when the component unmounts", async () => {
    let signal: AbortSignal | null | undefined;
    let writes = 0;
    const fetch: FetchLike = (_url, init) => {
      if (init?.method === "PUT") {
        writes += 1;
        return Promise.resolve(new Response("", { status: 200 }));
      }
      signal = init?.signal;
      return new Promise<Response>(() => undefined);
    };
    installFetch(fetch);

    await act(async () => root.render(<Probe />));
    await vi.waitFor(() => expect(signal).toBeDefined());
    expect(button(container, "overview").disabled).toBe(true);
    await act(async () => button(container, "overview").click());
    await act(async () => root.unmount());
    expect(signal?.aborted).toBe(true);
    expect(writes).toBe(0);

    root = createRoot(container);
  });
});
