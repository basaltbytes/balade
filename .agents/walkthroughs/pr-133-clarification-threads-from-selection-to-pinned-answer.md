---
walkthrough: 1
title: Clarification threads from selection to pinned answer
pr: 133
commit: 4bee0381edbe4a7f0dbfc5d867d117987e052a7d
meta:
  pr: "133"
  feature: walkthrough-clarifications
  commit: 4bee0381
  balade-authoring: 1.21.0
---

{% group label="Orientation" %}
{% section id="overview" title="Overview" %}
This change adds live clarification threads to served walkthroughs. A reviewer selects text, asks a question, and receives a compiled Markdoc answer in a section-bound thread. Follow-up questions reuse the earlier turns as prompt context.

The main review constraint is trust. The selected text, question, earlier answers, walkthrough, and repository are all untrusted. The server binds each thread to the displayed PR and commit, runs each answer in a fresh pinned inspection session, validates the answer before storage, and persists only compiled `Block` values. Static exports do not enable this feature because the Q&A provider marks it unavailable outside served mode.

The change also centralizes provider and model setup. Generation, live clarification, `balade agent setup`, and `balade agent logout` now use one model manager.
{% /section %}
{% /group %}

{% group label="Mechanism" %}
{% section id="clarification-flow" title="Clarification workflow" related=["qa-state","reviewer-interface","safety-proof"] %}
The browser sends the walkthrough path, the displayed PR and commit, and either a new anchor or an existing thread ID. The server verifies the generation before setup, after setup, and after repository context preparation. It does not persist the question if any check finds a newer generation.

{% code file="src/server/qa.ts" from=238 to=299 expect="        const loadRequestPayload = Effect.fn(\"QaWorkflow.loadRequestPayload\")(function* (" collapsed=true /%}

After validation, the server writes a pending thread under a one-permit lock. It then forks the clarification worker in the server scope. This makes the pending state visible immediately while generation continues in the background.

```mermaid
sequenceDiagram
  participant UI as Walkthrough UI
  participant API as Q&A workflow
  participant Pi as Fresh Pi session
  participant Store as Q&A sidecar
  UI->>API: Ask with PR and stamp
  API->>API: Check generation and setup
  API->>Store: Write pending thread
  API-->>UI: Return pending state
  API->>Pi: Prompt with anchor and prior turns
  Pi->>API: Submit Markdoc fragment
  API->>API: Parse, resolve, compile
  API->>Store: Write answered or failed
  UI->>API: Poll current state
```

The worker gives Pi the pinned commit, base commit, changed files, source walkthrough, anchor, prior turns, and current question. Changed instruction files use the `omit-changed` policy. On success, the server appends one compiled turn. On any worker failure or interruption, it retains the question and earlier turns in a failed thread.

{% code file="src/server/qa.ts" from=307 to=405 expect="const enqueueQuestion = Effect.fn(\"QaWorkflow.enqueueQuestion\")(function* (" collapsed=true /%}

{% code file="src/server/qa.ts" from=410 to=475 expect="const compileAnswer = Effect.fn(\"QaWorkflow.compileAnswer\")(function* (" collapsed=true /%}

The submit tool validates inside the active Pi turn. It returns exact diagnostics for correction. It permits at most two repair attempts and stops early when the diagnostics do not change. Each call to `answer` creates and releases its own in-memory inspection session.

{% code file="src/pi/clarifier.ts" from=134 to=209 expect="      const answer = Effect.fn(\"WalkthroughClarifier.answer\")(function* <" collapsed=true /%}

{% code file="src/pi/clarifier.ts" from=217 to=279 expect="async function createClarificationSession<" collapsed=true /%}

A server restart cannot resume an in-memory worker. On the first read for a generation, the workflow converts every stored pending thread to failed. The UI permits a follow-up on that failed thread, so the question and prior answers remain available for retry.

{% code file="src/server/qa.ts" from=536 to=577 expect="function emptyState(path: string, payload: Payload): QaState {" collapsed=true /%}
{% /section %}
{% /group %}

{% group label="Models" %}
{% section id="qa-state" title="Generation-bound thread state" related=["clarification-flow"] %}
The contract represents a thread as a strict state union.

{% fields %}
{% field name="pending" kind="thread state" badges=["exclusive"] %}Contains completed turns plus exactly one active question.{% /field %}
{% field name="answered" kind="thread state" badges=["non-empty"] %}Contains at least one completed turn. Each answer is a non-empty array of canonical `Block` values.{% /field %}
{% field name="failed" kind="thread state" badges=["retryable"] %}Keeps completed turns, the refused or interrupted question, and its failure time.{% /field %}
{% field name="pr + stamp" kind="generation key" %}Binds the complete sidecar state and every ask request to the displayed walkthrough generation.{% /field %}
{% /fields %}

Thread and turn IDs must be UUID v4 values. New questions carry a section ID and selected excerpt. Follow-ups carry an existing thread ID instead of a new anchor.

{% code file="src/contract/schema.ts" from=417 to=505 expect="/** Provider details stay local to the CLI; the browser learns only whether Q&A can start. */" /%}

The store mirrors the walkthrough path under `.balade/` and adds the `.qa.json` suffix. Writes use a temporary file and rename it into place. Reads reject a copied sidecar whose serialized walkthrough owner does not match the requested path.

{% code file="src/state.ts" from=178 to=258 expect="function makeSidecarStore<State extends { readonly walkthrough: string }, ParseError>(" /%}

The path guard rejects absolute and climbing paths. It resolves each existing directory and file component, so a symbolic link cannot redirect state outside the repository-owned state tree.

{% code file="src/state.ts" from=263 to=315 expect="/** Resolve every existing path component before any write can follow it. */" /%}
{% /section %}
{% /group %}

{% group label="Surface" %}
{% section id="reviewer-interface" title="Reviewer interface" related=["clarification-flow","agent-configuration"] %}
In served mode, selecting up to 2,000 normalized characters inside one walkthrough section shows the ask action. A selection that crosses sections or starts in the Q&A panel is rejected. The action opens a side panel with the selected excerpt and question form.

{% code file="app/src/ui/qa.tsx" from=18 to=84 expect="export function SelectionAsk() {" /%}

The provider polls Q&A state every 1.5 seconds. It pauses effective reconciliation while a request is active and uses an epoch to prevent an older poll from replacing newly submitted state. A payload change aborts the old lifecycle and resets the panel and local state.

{% code file="app/src/ui/qa-context.tsx" from=88 to=154 expect="export function QaProvider({" /%}

Each section shows an exchange count when threads exist. The panel renders answer blocks through the existing `BlockView`, including code, widgets, pseudo-code fences, and Mermaid diagrams. A persistent sidebar lists answered, pending, and failed threads with localized status labels.

{% callout tone="key" %}
The browser checks agent readiness only when the reviewer opens a Q&A surface. Opening a walkthrough does not start Pi setup.
{% /callout %}
{% /section %}

{% section id="agent-configuration" title="Shared agent configuration" related=["reviewer-interface"] %}
The model manager serializes setup and logout. `ensure` reuses a valid saved preference. If none is available, it starts terminal setup and stores the selected model. Generation calls the same manager directly, so generation and Q&A share provider and model policy.

{% code file="src/agent/model.ts" from=163 to=201 expect="export const readAgentModelState = Effect.fn(\"readAgentModelState\")(function* (" /%}

The new CLI surface supports explicit setup filters and removal of all stored Balade agent logins.

{% code file="src/commands/agent/index.ts" from=19 to=38 expect="const setupCommand = Command.make(\"setup\", { provider, model }, (config) =>" /%}
{% /section %}
{% /group %}

{% group label="Quality" %}
{% section id="safety-proof" title="Validation and regression proof" related=["clarification-flow","qa-state"] %}
Clarification answers reuse the walkthrough parser inside a synthetic section. The parser rejects frontmatter, an outer fence, empty answers, unavailable presets, and tags that could create sections, groups, or file browsers. Compilation then uses the normal block compiler and resolves referenced code files against the pinned context.

{% code file="src/walkthrough/fragment.ts" from=23 to=108 expect="/**" /%}

The HTTP edge requires JSON for questions, limits the body to 64 KiB, keeps the existing loopback host guard, and maps stale generation requests to HTTP 412. Provider and credential details never enter the browser contract; `/api/agent` returns only `ready` or `setup-required`.

{% code file="src/server/http.ts" from=29 to=48 expect="/** A review tool listens for the reviewer, not for the network. */" /%}

{% tests %}
{% test name="clarification workflow states" kind="http" ref="test/qa.test.ts" asserts=["does not persist after cancelled setup", "rejects a generation changed during setup", "persists pending, answered, follow-up, and failed states", "turns interrupted workers into failed threads"] %}Runs the workflow through fixture repositories, real context resolution, and file sidecars while replacing only the Pi port.{% /test %}
{% test name="bounded answer repair" kind="unit" ref="test/clarifier.test.ts" asserts=["returns exact validation diagnostics", "accepts two changing repairs", "stops on unchanged diagnostics", "preserves validation failures"] %}Uses a faux provider to drive the real submit tool and active Pi session.{% /test %}
{% test name="fragment grammar" kind="unit" ref="test/qa-fragment.test.ts" asserts=["discovers code references", "rejects document structure", "rejects unavailable presets", "rejects empty and enveloped answers"] %}Checks the clarification-only restrictions around the canonical walkthrough grammar.{% /test %}
{% test name="reviewer Q&A lifecycle" kind="unit" ref="app/src/ui/qa.test.tsx" asserts=["opens compiled answers", "keeps pending threads in the sidebar", "preserves refused drafts", "discards stale in-flight responses", "prevents old polls from hiding submissions"] %}Exercises the served React state transitions with controlled fetch responses.{% /test %}
{% test name="agent model policy" kind="unit" ref="test/agent-model.test.ts" asserts=["reuses saved preferences", "runs login and remembers selection", "falls back from unavailable filters", "returns to setup-required after logout"] %}Covers setup, selection, cancellation, preference failures, and logout through injected ports.{% /test %}
{% /tests %}
{% /section %}
{% /group %}

{% group label="Full PR diff" %}
{% section id="files" title="Full PR diff" icon="file-diff" %}
{% files %}
{% filegroup label="Tests" only="**/*.test.ts" /%}
{% filegroup label="App" only="app/**" /%}
{% filegroup label="Agent configuration" only="src/agent/**" /%}
{% filegroup label="Pi runtime" only="src/pi/**" /%}
{% filegroup label="Server and state" only="src/server/**" /%}
{% filegroup label="Contract" only="src/contract/**" /%}
{% filegroup label="Walkthrough compiler" only="src/walkthrough/**" /%}
{% filegroup label="CLI commands" only="src/commands/**" /%}
{% filegroup label="Documentation" only="docs/**" /%}
{% filegroup label="Release notes" only=".changeset/**" /%}
{% filegroup label="Misc" /%}
{% /files %}
{% /section %}
{% /group %}
