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
import { QaSidebar } from "./qa-sidebar";
import { QaIndicator, QaPanel } from "./qa";
import { StringsProvider } from "./strings";

const threadId = QaThreadId.make("34d91d9f-21f4-4c3b-9b72-b1f76166395c");
const turnId = QaTurnId.make("57992f39-f492-4b7c-8580-d2483916bba2");
const pendingThreadId = QaThreadId.make("e5f2c1d4-b271-47ae-aacb-c67d59a57bc9");
const pendingTurnId = QaTurnId.make("da10bbcd-8cca-4ff5-bb22-b2ab0a8d86f0");
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
const pendingState: QaState = {
  ...state,
  threads: [
    ...state.threads,
    {
      id: pendingThreadId,
      anchor: { sectionId: "overview", excerpt: "The planning pool is live." },
      status: "pending",
      turns: [],
      pending: {
        id: pendingTurnId,
        question: "How does the worker finish?",
        askedAt: "2026-08-15T10:01:00.000Z",
      },
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

  it.effect("keeps a closed pending question reachable from the sidebar", () =>
    Effect.gen(function* () {
      installFetch((url) =>
        Promise.resolve(
          url.startsWith("/api/qa")
            ? Response.json(pendingState)
            : new Response("", { status: 404 }),
        ),
      );
      yield* Effect.promise(() =>
        act(async () => {
          root.render(
            <StringsProvider lang="en">
              <QaProvider payload={payload} served>
                <QaSidebar
                  sections={new Map(payload.sections.map((section) => [section.id, section]))}
                />
                <QaPanel />
              </QaProvider>
            </StringsProvider>,
          );
        }),
      );
      const label = "How does the worker finish? · Working";
      yield* Effect.promise(() =>
        vi.waitFor(() =>
          expect(container.querySelector(`button[aria-label="${label}"]`)).not.toBeNull(),
        ),
      );
      const thread = container.querySelector(`button[aria-label="${label}"]`);
      if (!(thread instanceof HTMLButtonElement)) {
        return yield* Effect.die("pending sidebar thread missing");
      }
      yield* Effect.promise(() => act(async () => thread.click()));
      expect(container.querySelector("[data-qa-panel]")).not.toBeNull();
      expect(container.querySelector("[data-qa-thread]")?.getAttribute("data-qa-thread")).toBe(
        pendingThreadId,
      );

      const close = container.querySelector(
        '[data-qa-panel] button[aria-label="Close clarifications"]',
      );
      if (!(close instanceof HTMLButtonElement)) {
        return yield* Effect.die("clarification close button missing");
      }
      yield* Effect.promise(() => act(async () => close.click()));

      expect(container.querySelector("[data-qa-panel]")).toBeNull();
      expect(container.querySelector(`button[aria-label="${label}"]`)).not.toBeNull();
      expect(container.textContent).toContain("Overview");
    }),
  );

  it.effect("keeps a follow-up draft when agent setup is refused", () =>
    Effect.gen(function* () {
      let stateReads = 0;
      installFetch((url, init) => {
        if (url === "/api/agent") return Promise.resolve(Response.json({ status: "ready" }));
        if (init?.method !== "POST") stateReads++;
        return Promise.resolve(
          init?.method === "POST" ? new Response("", { status: 503 }) : Response.json(state),
        );
      });
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

      const textarea = container.querySelector(`#qa-follow-up-${threadId}`);
      if (!(textarea instanceof HTMLTextAreaElement)) {
        return yield* Effect.die("follow-up textarea missing");
      }
      yield* Effect.promise(() =>
        act(async () => {
          const valueSetter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            "value",
          )?.set;
          if (valueSetter === undefined) throw new Error("textarea value setter missing");
          valueSetter.call(textarea, "Please keep this draft");
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
        }),
      );
      const form = textarea.closest("form");
      if (!(form instanceof HTMLFormElement)) return yield* Effect.die("follow-up form missing");
      yield* Effect.promise(() => act(async () => form.requestSubmit()));

      yield* Effect.promise(() =>
        vi.waitFor(() => expect(container.textContent).toContain("Agent setup did not finish.")),
      );
      yield* Effect.promise(() =>
        vi.waitFor(() => expect(stateReads).toBeGreaterThan(1), { timeout: 2_500 }),
      );
      expect(container.textContent).toContain("Agent setup did not finish.");
      expect(textarea.value).toBe("Please keep this draft");
    }),
  );

  it.effect("keeps the first question while terminal agent setup completes", () =>
    Effect.gen(function* () {
      let resolveQuestion: ((response: Response) => void) | undefined;
      let submittedBody = "";
      let agentChecks = 0;
      installFetch((url, init) => {
        if (url === "/api/agent") {
          agentChecks++;
          return Promise.resolve(Response.json({ status: "setup-required" }));
        }
        if (init?.method === "POST") {
          submittedBody = String(init.body ?? "");
          return new Promise((resolve) => {
            resolveQuestion = resolve;
          });
        }
        return Promise.resolve(Response.json({ ...state, threads: [] }));
      });
      yield* Effect.promise(() =>
        act(async () => {
          root.render(
            <StringsProvider lang="en">
              <QaProvider payload={payload} served>
                <QaComposerProbe />
                <QaPanel />
              </QaProvider>
            </StringsProvider>,
          );
        }),
      );
      expect(agentChecks).toBe(0);
      const open = container.querySelector('button[aria-label="open question composer"]');
      if (!(open instanceof HTMLButtonElement))
        return yield* Effect.die("composer trigger missing");
      yield* Effect.promise(() => act(async () => open.click()));
      yield* Effect.promise(() =>
        vi.waitFor(() => {
          expect(agentChecks).toBe(1);
          expect(container.textContent).toContain("Agent setup is required.");
          expect(container.textContent).toContain("Set up & ask");
        }),
      );

      const textarea = container.querySelector("#qa-question");
      if (!(textarea instanceof HTMLTextAreaElement)) {
        return yield* Effect.die("question textarea missing");
      }
      yield* Effect.promise(() =>
        act(async () => {
          const valueSetter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            "value",
          )?.set;
          if (valueSetter === undefined) throw new Error("textarea value setter missing");
          valueSetter.call(textarea, "How does this work?");
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
        }),
      );
      const form = textarea.closest("form");
      if (!(form instanceof HTMLFormElement)) return yield* Effect.die("question form missing");
      yield* Effect.promise(() => act(async () => form.requestSubmit()));
      yield* Effect.promise(() =>
        vi.waitFor(() => {
          expect(submittedBody).toContain("How does this work?");
          expect(container.textContent).toContain("Continue setup in the terminal…");
          expect(textarea.value).toBe("How does this work?");
        }),
      );

      const resolve = resolveQuestion;
      if (resolve === undefined) return yield* Effect.die("question resolver missing");
      yield* Effect.promise(() =>
        act(async () => {
          resolve(Response.json(pendingState));
          await Promise.resolve();
        }),
      );
      expect(container.textContent).toContain("How does the worker finish?");
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

function QaComposerProbe() {
  const qa = useQa();
  return (
    <button
      type="button"
      aria-label="open question composer"
      onClick={() =>
        qa.openComposer({
          sectionId: "overview",
          excerpt: "The planning pool is live.",
        })
      }
    />
  );
}
