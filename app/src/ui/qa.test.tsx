// @vitest-environment jsdom

import { Effect } from "effect";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "@effect/vitest";
import { QaThreadId, QaTurnId } from "../../../src/contract/schema";
import type { QaState } from "../contract";
import type { FetchLike } from "../data/browser";
import { pr96 } from "../fixtures/pr96";
import { QaProvider, useQa } from "./qa-context";
import { QaIndicator, QaPanel } from "./qa";
import { StringsProvider } from "./strings";

const threadId = QaThreadId.make("34d91d9f-21f4-4c3b-9b72-b1f76166395c");
const turnId = QaTurnId.make("57992f39-f492-4b7c-8580-d2483916bba2");
const payload = {
  ...pr96,
  files: [],
  nav: [],
  sections: [{ id: "overview", title: "Overview", hash: "sha256:overview", blocks: [] }],
  errors: [],
};
const state: QaState = {
  version: 1,
  walkthrough: payload.sourcePath,
  pr: payload.pr.number,
  stamp: payload.commit,
  threads: [
    {
      id: threadId,
      anchor: { sectionId: "overview", excerpt: "The planning pool is live." },
      status: "answered",
      turns: [
        {
          id: turnId,
          question: "Why is this safe?",
          askedAt: "2026-08-15T10:00:00.000Z",
          answeredAt: "2026-08-15T10:00:01.000Z",
          answer: [{ b: "md", nodes: [{ p: ["Because the answer is pinned."] }] }],
        },
      ],
    },
  ],
};
const secondPayload = {
  ...payload,
  sourcePath: "walkthroughs/second.md",
  commit: "abcdef2",
};
const secondState: QaState = {
  version: 1,
  walkthrough: secondPayload.sourcePath,
  pr: secondPayload.pr.number,
  stamp: secondPayload.commit,
  threads: [],
};

const installFetch = (fetch: FetchLike): void => {
  Object.defineProperty(window, "fetch", { configurable: true, writable: true, value: fetch });
};

describe("clarification threads in the walkthrough", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it.effect("shows a section indicator and opens the compiled answer", () =>
    Effect.gen(function* () {
      installFetch((url) =>
        Promise.resolve(
          url.startsWith("/api/qa") ? Response.json(state) : new Response("", { status: 404 }),
        ),
      );
      yield* Effect.promise(() =>
        act(async () => {
          root.render(
            <StringsProvider lang="en">
              <QaProvider payload={payload} served>
                <QaIndicator sectionId="overview" />
                <QaPanel />
              </QaProvider>
            </StringsProvider>,
          );
        }),
      );
      yield* Effect.promise(() =>
        vi.waitFor(() =>
          expect(container.querySelector('button[aria-label="1 exchange"]')).not.toBeNull(),
        ),
      );
      const indicator = container.querySelector('button[aria-label="1 exchange"]');
      if (!(indicator instanceof HTMLButtonElement)) {
        return yield* Effect.die("clarification indicator missing");
      }
      yield* Effect.promise(() => act(async () => indicator.click()));
      expect(container.textContent).toContain("Why is this safe?");
      expect(container.textContent).toContain("Because the answer is pinned.");
      expect(container.textContent).toContain("Ask a follow-up");
    }),
  );

  it.effect("discards an in-flight answer when the walkthrough changes", () =>
    Effect.gen(function* () {
      let resolveOldQuestion: ((response: Response) => void) | undefined;
      installFetch((url, init) => {
        if (init?.method === "POST") {
          return new Promise((resolve) => {
            resolveOldQuestion = resolve;
          });
        }
        return Promise.resolve(
          Response.json(url.includes("second.md") ? secondState : { ...state, threads: [] }),
        );
      });
      yield* Effect.promise(() =>
        act(async () => {
          root.render(
            <StringsProvider lang="en">
              <QaProvider payload={payload} served>
                <QaProbe />
              </QaProvider>
            </StringsProvider>,
          );
        }),
      );
      yield* Effect.promise(() =>
        vi.waitFor(() => expect(container.textContent).toContain(payload.sourcePath)),
      );
      const ask = container.querySelector('button[aria-label="ask old walkthrough"]');
      if (!(ask instanceof HTMLButtonElement)) return yield* Effect.die("ask button missing");
      yield* Effect.promise(() => act(async () => ask.click()));
      yield* Effect.promise(() => vi.waitFor(() => expect(resolveOldQuestion).not.toBeUndefined()));
      const resolve = resolveOldQuestion;
      if (resolve === undefined) return yield* Effect.die("old question resolver missing");

      yield* Effect.promise(() =>
        act(async () => {
          root.render(
            <StringsProvider lang="en">
              <QaProvider payload={secondPayload} served>
                <QaProbe />
              </QaProvider>
            </StringsProvider>,
          );
        }),
      );
      yield* Effect.promise(() =>
        vi.waitFor(() => expect(container.textContent).toContain(secondPayload.sourcePath)),
      );
      yield* Effect.promise(() =>
        act(async () => {
          resolve(Response.json(state));
          await Promise.resolve();
        }),
      );

      expect(container.textContent).toContain(secondPayload.sourcePath);
      expect(container.textContent).not.toContain("Why is this safe?");
    }),
  );
});

function QaProbe() {
  const qa = useQa();
  return (
    <div>
      <button
        type="button"
        aria-label="ask old walkthrough"
        onClick={() =>
          qa.ask({
            kind: "new",
            anchor: { sectionId: "overview", excerpt: "The planning pool is live." },
            question: "Why is this safe?",
          })
        }
      />
      <output>
        {qa.state.walkthrough}
        {qa.state.threads.flatMap((thread) => thread.turns.map((turn) => turn.question)).join("|")}
      </output>
    </div>
  );
}
