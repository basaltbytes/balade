import React, { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Effect } from "effect";
import {
  Diff,
  Walkthrough,
  WalkthroughView,
  ClarificationAgentUnavailable,
  ClarificationGenerationChanged,
} from "@balade/viewer";
import "./host.css";
import "@balade/viewer/viewer.css";

const attack =
  '<script>globalThis.pwned=true</script><img src="https://evil.example/pixel" onerror="globalThis.pwned=true">';
const code = "export const answer = 42;";
const payload = {
  format: 1,
  walkthrough: 1,
  title: "Embedded review",
  commit: "abcdef1",
  headDistance: 0,
  lang: "en",
  meta: {},
  pr: {
    number: 164,
    url: "https://github.com/basaltbytes/balade/pull/164",
    author: "author",
    state: "open",
    base: "main",
    head: "feature/viewer",
    commits: 1,
    stats: { files: 1, additions: 1, deletions: 1 },
  },
  files: [
    {
      path: "example.ts",
      status: "M",
      lang: "typescript",
      hash: "sha256:file",
      additions: 1,
      deletions: 1,
      diff: {
        unified: `@@ -1 +1 @@\n-${attack}\n+${code}\n`,
        oldContent: attack,
        newContent: code,
      },
    },
  ],
  nav: [
    { kind: "section", ref: "overview", label: "Overview" },
    { kind: "section", ref: "evidence", label: "Evidence" },
  ],
  sections: [
    {
      id: "overview",
      title: "Overview",
      hash: "sha256:overview",
      blocks: [
        {
          b: "md",
          nodes: [
            { p: ["Select this passage to ask a question."] },
            {
              p: [
                attack,
                " javascript:alert(1) data:text/html,hello ![image](https://evil.example/pixel)",
              ],
            },
          ],
        },
        { b: "fence", lang: "typescript", source: code },
        { b: "mermaid", source: "graph TD\n a[Read] --> b[Review]" },
        ...[
          attack,
          'graph TD\n a@{ img: "https://evil.example/pixel" }',
          'graph TD\n a@{ "img": "/pixel" }',
          'graph TD\n a["/*"]\n b@{ img: "/pixel" }\n c["*/"]',
          "graph TD\n a[bad]\n style a fill:url(https://evil.example/pixel)",
          'graph TD\n a[bad]\n click a href "javascript:alert(1)"',
        ].map((source) => ({ b: "mermaid", source })),
        { b: "fence", lang: "html", source: attack },
        {
          b: "code",
          file: "example.ts",
          from: 1,
          to: 1,
          lang: "html",
          view: "diff",
          lines: [attack],
          changed: [1],
        },
      ],
    },
    {
      id: "evidence",
      title: "Evidence",
      hash: "sha256:evidence",
      blocks: [{ b: "files", paths: ["example.ts"] }],
    },
  ],
  errors: [],
  sourcePath: "walkthroughs/example.md",
};
const diffFiles = [
  {
    path: "example.ts",
    status: "modified",
    additions: 1,
    deletions: 1,
    patch: { kind: "text", text: `@@ -1 +1 @@\n-${attack}\n+${code}\n` },
  },
  {
    path: "src/<b>hostile</b>.ts",
    oldPath: "src/old.ts",
    status: "renamed",
    additions: 0,
    deletions: 0,
    patch: { kind: "text", text: "" },
    test: true,
  },
  { path: "logo.png", status: "added", additions: 0, deletions: 0, patch: { kind: "binary" } },
];
const openedFiles = [];
let review = null;
let qa = {
  version: 1,
  walkthrough: payload.sourcePath,
  pr: 164,
  stamp: payload.commit,
  threads: [],
};
const listeners = new Set();
let behavior = "answer";
const host = {
  reviewState: {
    load: async () => review,
    save: async (state) => {
      review = state;
    },
  },
  clarifications: {
    status: async () => ({ status: "ready" }),
    load: async () => qa,
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    async ask(request) {
      if (behavior === "generation") throw new ClarificationGenerationChanged();
      if (behavior === "unavailable") throw new ClarificationAgentUnavailable();
      const id = "34d91d9f-21f4-4c3b-9b72-b1f76166395c";
      const turn = {
        id: crypto.randomUUID(),
        question: request.question,
        askedAt: new Date().toISOString(),
      };
      const existing = qa.threads.find((thread) => thread.id === id);
      const anchor = request.kind === "new" ? request.anchor : existing.anchor;
      const turns = existing?.turns ?? [];
      qa = { ...qa, threads: [{ id, anchor, turns, status: "pending", pending: turn }] };
      setTimeout(() => {
        qa = {
          ...qa,
          threads: [
            {
              id,
              anchor,
              turns:
                behavior === "failed"
                  ? turns
                  : [
                      ...turns,
                      {
                        ...turn,
                        answeredAt: new Date().toISOString(),
                        answer: [
                          { b: "md", nodes: [{ p: ["Pinned answer.", attack] }] },
                          { b: "fence", lang: "html", source: attack },
                          {
                            b: "mermaid",
                            source: 'graph TD\n a@{ img: "https://evil.example/answer-pixel" }',
                          },
                        ],
                      },
                    ],
              ...(behavior === "failed"
                ? { status: "failed", failed: turn, failedAt: new Date().toISOString() }
                : { status: "answered" }),
            },
          ],
        };
        listeners.forEach((notify) => notify(qa));
      }, 200);
      return qa;
    },
  },
};

function Fixture() {
  const scrollRoot = useRef(null);
  const [section, setSection] = useState("");
  return (
    <>
      <div id="first">
        <WalkthroughView payload={payload} host={host} />
      </div>
      <div id="second">
        <WalkthroughView payload={payload} />
      </div>
      <output id="active-section">{section}</output>
      <div id="scroll-root" ref={scrollRoot}>
        <Walkthrough.Root
          payload={payload}
          section={section}
          onSectionChange={setSection}
          scrollRoot={scrollRoot}
        >
          <Walkthrough.Header />
          <div id="composed">
            <aside>
              <Walkthrough.Nav />
            </aside>
            <article>
              <Walkthrough.Sections />
            </article>
          </div>
          <Walkthrough.Clarifications />
        </Walkthrough.Root>
      </div>
      <div id="diff">
        <Diff
          files={diffFiles}
          defaultExpanded
          fileHref={(file) =>
            file === diffFiles[1] ? "javascript:alert(1)" : `/files/${file.path}`
          }
          onFileOpen={(file, event) => {
            event.preventDefault();
            openedFiles.push(file.path);
          }}
        />
      </div>
      <div id="unsupported">
        <WalkthroughView payload={{ format: 2, lang: "fr" }} />
      </div>
      <div id="invalid-url">
        <WalkthroughView
          payload={{ ...payload, pr: { ...payload.pr, url: "javascript:alert(1)" } }}
        />
      </div>
    </>
  );
}

const root = createRoot(document.getElementById("root"));
document.getElementById("mount").addEventListener("click", () =>
  root.render(
    <StrictMode>
      <Fixture />
    </StrictMode>,
  ),
);
globalThis.viewerFixture = {
  readReview: () => review,
  changeBehavior: (next) => {
    behavior = next;
  },
  subscriptions: () => listeners.size,
  openedFiles: () => openedFiles,
  unmount: () => root.unmount(),
};
// The consumer owns a different Effect major; the viewer never borrows its runtime.
if (Effect.runSync(Effect.succeed(42)) !== 42) throw new Error("host Effect failed");
