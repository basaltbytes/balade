// @vitest-environment jsdom

import { Effect } from "effect";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "@effect/vitest";
import { QaThreadId, QaTurnId } from "../../../src/contract/schema";
import type { QaState } from "../contract";
import type { FetchLike } from "../data/browser";
import { pr96 } from "../fixtures/pr96";
import { QaProvider } from "./qa-context";
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
});
