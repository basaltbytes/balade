---
walkthrough: 1
title: Clarification threads from selection to pinned answer
pr: 133
commit: 2293391bc9d24020eb4b80db4c005e21b62f6528
meta:
  pr: "133"
  feature: walkthrough-clarifications
  lang: en
  balade-authoring: 1.33.0
---

{% group label="Overview" %}
{% section id="overview" title="Overview" icon="question" %}
This change adds **live clarification threads** to served walkthroughs. A reviewer selects a passage, asks a question, and receives an answer that can use the same compiled blocks as the walkthrough. Follow-up questions keep the thread context. Pending, answered, and failed threads remain available in the sidebar.

The main review constraint is the trust boundary. The browser binds each request to the displayed PR and commit. The server checks that generation, runs a fresh read-only Pi session, validates the submitted Markdoc fragment, and persists compiled `Block` values instead of model-produced HTML. Static exports do not enable Q&A.

The change also moves provider and model selection into one shared manager. Generation, first-use Q&A setup, `balade agent setup`, and `balade agent logout` now use the same configuration policy.
{% /section %}
{% /group %}

{% group label="Clarification workflow" %}
{% section id="thread-flow" title="From selected passage to durable thread" icon="workflow" related=["answer-validation","reviewer-surface"] %}
The browser sends either a new anchor or an existing thread ID. Every request also carries the PR number and stamp that the page displays. The thread contract makes each lifecycle state explicit: `pending` carries one active question, `answered` carries at least one completed turn, and `failed` preserves the refused or interrupted question.

{% code file="src/contract/schema.ts" from=433 to=505 expect="export const QaGeneration = Schema.Struct({" collapsed=true /%}

The server checks the generation three times: before model setup, after setup, and after it prepares the walkthrough source and repository context. A stale page therefore cannot persist a question against a newer walkthrough. Setup cancellation also happens before the pending state is written.

{% code file="src/server/qa.ts" from=238 to=299 expect="        const loadRequestPayload = Effect.fn(\"QaWorkflow.loadRequestPayload\")(function* (" collapsed=true /%}

After these checks, the server writes `pending` while it holds the workflow semaphore. It then forks a worker in the server scope and returns the pending state to the browser. The worker receives the pinned commit, base commit, changed-file summary, walkthrough source, anchor, completed turns, and current question. Changed repository instruction files are always omitted from clarification sessions.

```mermaid
sequenceDiagram
  participant UI as Walkthrough UI
  participant Q as Q&A workflow
  participant Pi as Fresh Pi session
  participant S as Sidecar
  UI->>Q: Ask with PR and stamp
  Q->>Q: Check generation and setup
  Q->>S: Write pending
  Q-->>UI: Return pending state
  Q->>Pi: Inspect and answer
  Pi->>Q: Submit Markdoc fragment
  Q->>Q: Parse and compile
  Q->>S: Write answered or failed
  UI->>Q: Poll state
```

The pending write and worker handoff are uninterruptible. The worker installs an exit handler that converts an error or interruption to `failed`. A process crash cannot run that handler, so the first read after restart converts abandoned pending entries to failed once for that walkthrough generation.

{% code file="src/server/qa.ts" from=307 to=405 expect="const enqueueQuestion = Effect.fn(\"QaWorkflow.enqueueQuestion\")(function* (" collapsed=true /%}

{% code file="src/server/qa.ts" from=536 to=577 expect="function emptyState(path: string, payload: Payload): QaState {" collapsed=true /%}
{% /section %}

{% section id="answer-validation" title="Canonical answer validation and bounded repair" icon="shield-check" related=["thread-flow"] %}
Each question creates a scoped Pi session. Generation and clarification share one sandbox assembler, so both use the pinned snapshot, in-memory session policy, and six Balade-owned inspection tools. Each workflow adds only its own terminating submit tool.

{% code file="src/pi/session.ts" from=171 to=204 expect="export async function createInspectionSession(" collapsed=true /%}

The clarification submit tool validates while the Pi turn is active. A rejected answer returns the exact diagnostics as untrusted tool data. The same session can submit a complete replacement. Repair stops after two changing attempts or as soon as the diagnostic set repeats.

{% code file="src/pi/clarifier.ts" from=223 to=279 expect="  model: Model<string>," collapsed=true /%}

The validator wraps the answer in a synthetic section and uses the normal walkthrough parser. It rejects frontmatter, an outer fence, empty content, unavailable presets, and whole-document `section`, `group`, or `files` tags. It then calls the canonical block compiler. Code references that were not in the initial context trigger another resolution at the pinned generation before compilation.

{% code file="src/walkthrough/fragment.ts" from=27 to=100 expect="export function parseFragment(" /%}

{% code file="src/server/qa.ts" from=410 to=439 expect="const compileAnswer = Effect.fn(\"QaWorkflow.compileAnswer\")(function* (" /%}

{% callout tone="key" %}
Only compiled `Block` arrays reach answered state. The PR adds no Q&A-specific HTML sink.
{% /callout %}
{% /section %}
{% /group %}

{% group label="Reviewer surface and local state" %}
{% section id="reviewer-surface" title="Selection, polling, and thread recovery" icon="browser" related=["thread-flow","local-boundaries"] %}
The selection control accepts normalized text from one walkthrough section and caps the excerpt at 2,000 characters. It rejects cross-section selections and selections inside the Q&A panel. Each section can show an exchange count, while the sidebar gives every thread an independent route back to its panel.

{% code file="app/src/ui/qa.tsx" from=18 to=84 expect="export function SelectionAsk() {" /%}

The React provider polls every 1.5 seconds only in served mode. It pauses effective reconciliation during a POST and increments an epoch before submission. An older poll cannot replace the pending state returned by that POST. A payload change aborts the previous lifecycle and resets Q&A state, which prevents an old response from entering a new walkthrough generation.

{% code file="app/src/ui/qa-context.tsx" from=106 to=154 expect="  useEffect(() => {" /%}

Opening a Q&A surface checks only `ready` versus `setup-required`; opening the walkthrough itself does not start Pi. The panel renders answer blocks through the existing `BlockView`, including pinned code, structured widgets, pseudo-code, and Mermaid.
{% /section %}

{% section id="local-boundaries" title="Path-safe sidecars and shared agent setup" icon="lock" related=["reviewer-surface"] %}
Review and Q&A state now mirror the complete walkthrough path below `.balade/`. The suffix is appended to the complete name, so extensionless paths and same-basename walkthroughs stay distinct. Writes use a same-directory temporary file and rename, and reads verify the serialized walkthrough owner.

{% code file="src/state.ts" from=178 to=257 expect="function makeSidecarStore<State extends { readonly walkthrough: string }, ParseError>(" /%}

Before file access, the store rejects uncontained paths. It checks every existing directory and file against its expected canonical path. A symlink cannot redirect a sidecar outside the state tree. Concurrent directory creation ignores only `AlreadyExists`, then runs the same canonical-path and directory-type checks.

{% code file="src/state.ts" from=264 to=351 expect="const safeSidecarFile = Effect.fn(\"SidecarStore.safeFile\")(function* (" /%}

{% callout tone="warn" %}
The review sidecar location also changes from a basename-only file to the full mirrored walkthrough path. There is no legacy lookup. Existing local review marks at the old location will not load after this change.
{% /callout %}

The shared model manager serializes setup, explicit configuration, and logout. `ensure` rechecks the saved preference after it acquires the permit, so concurrent first questions cannot open competing terminal setup flows. The new CLI commands let reviewers configure this state in advance or remove all stored Balade provider credentials.

{% code file="src/agent/model.ts" from=175 to=201 expect="export const makeAgentModelManager = Effect.fn(\"makeAgentModelManager\")(function* (" /%}
{% /section %}
{% /group %}

{% group label="Regression proof" %}
{% section id="proof" title="Workflow, boundary, and UI coverage" icon="beaker" related=["answer-validation","local-boundaries"] %}
{% tests %}
{% test name="Clarification workflow states" kind="http" ref="test/qa.test.ts" asserts=["does not persist after cancelled setup", "rejects a generation changed during setup", "recovers abandoned pending work as failed", "persists pending, answered, follow-up, and failed states"] %}The tests use fixture repositories, real context resolution, and real sidecar files while replacing only the clarifier and model-manager ports.{% /test %}
{% test name="Answer repair" kind="unit" ref="test/clarifier.test.ts" asserts=["returns exact diagnostics", "accepts two changing repairs", "stops on repeated diagnostics", "preserves validator failures and interruption"] %}A faux Pi provider drives the real `submit_answer` tool and scoped session.{% /test %}
{% test name="Fragment grammar" kind="unit" ref="test/qa-fragment.test.ts" asserts=["discovers code references", "rejects document structure and unavailable presets", "rejects empty or enveloped answers"] %}These cases verify the clarification restrictions around the canonical parser.{% /test %}
{% test name="Reviewer Q&A lifecycle" kind="unit" ref="app/src/ui/qa.test.tsx" asserts=["opens compiled answers", "keeps pending threads reachable", "preserves refused drafts", "discards old-generation responses", "prevents stale polls from hiding submissions"] %}Controlled browser fetch responses exercise the React state transitions.{% /test %}
{% test name="Sidecar containment" kind="unit" ref="test/server.test.ts" asserts=["keeps same-basename walkthroughs independent", "rejects climbing paths and symlink redirects", "allows concurrent first review and Q&A writes"] %}The file-store tests cover the new mirrored layout and atomic initialization boundary.{% /test %}
{% test name="Shared model policy" kind="unit" ref="test/agent-model.test.ts" asserts=["reuses preferences", "serializes setup", "handles selection and cancellation", "returns to setup-required after logout"] %}Injected author and terminal ports verify setup policy without module mocking.{% /test %}
{% /tests %}
{% /section %}
{% /group %}

{% group label="Full PR diff" %}
{% section id="files" title="Full PR diff" icon="file-diff" %}
{% files %}
{% filegroup label="Walkthrough app" only="app/**" /%}
{% filegroup label="Agent and Pi" only="{src/agent/**,src/pi/**,src/commands/agent/**,src/commands/generate/**}" /%}
{% filegroup label="Q&A server and state" only="{src/server/**,src/state.ts,src/submission.ts}" /%}
{% filegroup label="Contract and compiler" only="{src/contract/**,src/walkthrough/**}" /%}
{% filegroup label="Tests" only="test/**" /%}
{% filegroup label="Documentation and walkthroughs" only="{README.md,SECURITY.md,DECISIONS.md,docs/**,.agents/walkthroughs/**}" /%}
{% filegroup label="Release and package" only="{.changeset/**,package.json,scripts/**}" /%}
{% filegroup label="Misc" /%}
{% /files %}
{% /section %}
{% /group %}
