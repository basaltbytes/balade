# Decisions

Trade-offs this package has already weighed. Each entry states what holds today
and what would move it.

## The payload contract is Effect Schema

Supersedes "the payload contract stays plain interfaces" (2026-08-02). The
source of truth is `src/payload/schema.ts`, with `src/payload/types.ts` derived
from it (`typeof X.Type`) — still the type-only entry the SPA imports through
`app/src/contract.ts`. Every JSON edge decodes deeply and rejects excess
properties; the deliberate exception is a namespaced preset block, whose open
JSON data must survive for a renderer that understands it. The preset rest
schema is `Schema.Json`, not `Schema.Unknown`, because values that cannot cross
the served or baked JSON edges are not part of the payload contract. A malformed
review mark invalidates its state file as one value rather than silently
salvaging part of it. Schema-derived collections and fields are readonly; code
that enriches a payload replaces values instead of mutating decoded contract
objects.

Frontmatter has a second, edge-only schema because YAML metadata accepts string,
finite-number and boolean scalars while the resolved contract carries strings.
Schema issue paths map back to the existing diagnostic codes, source lines and
hints; valid scalars are normalized, then the result passes through the canonical
`Frontmatter` schema. This keeps the encoded JSON of every persisted or
transported shape byte-compatible.

The cost of sharing the runtime schema with the SPA was measured on the Phase 1
build. The served entry grew from 1,545,312 to 1,611,014 bytes (+65,702; Vite
gzip 487.21 to 508.51 kB), and the single-file export JS from 3,971,906 to
4,037,646 bytes (+65,740; gzip 762.81 to 783.96 kB). That fixed cost buys one
contract and deep validation at both baked and served edges.

`src/payload/schema.ts` and `src/payload/parse-review.ts` are the pure shared
exceptions to "app imports the CLI as types only": the server and SPA guard the
same JSON. What stays forbidden is CLI *runtime* — git, fs, process — reaching
`app/`.

## Effect v4 is the codebase idiom

Supersedes "the core returns records; Effect stays at the CLI edge"
(2026-08-02): the owner rejected that reading — Effect v4 (services, layers,
typed error channels) is the idiom throughout, per the stack preference on the
spec map. The migration runs through
[#1](https://github.com/basaltbytes/balade/issues/1) in phases: Schema
contract, one error dialect, services and layers, core pipelines, the SPA.
During the transition the two dialects coexist — converted seams speak Effect,
the rest still answers `{ value, diagnostics }` records; each phase lands with
the pipeline green.

Two things survive the supersession: diagnostics stay values (`CheckDiagnostic`
is the product of `check`, not a failure — the error channel is for real
failures), and pure parse/compile functions stay pure, orchestrated from Effect
rather than wrapped in it. One version note: the pinned `effect@4.0.0-beta.102`
(the current `beta` dist-tag) names the service API `Context.Service` —
`ServiceMap` is later naming that most docs already use. Verify every API
against the installed `.d.ts` under `node_modules/effect/dist/`.

## The SPA has one browser runtime; React still owns render state

The SPA builds one module-level `ManagedRuntime` from live browser fetch and
storage layers. Payload loading returns an Effect with tagged unreadable/fetch
failures, and review persistence composes the `localStore` and `httpStore`
layers once behind a `ReviewStore` service. Those layers take the browser
capabilities as inputs; the service selects served or export behavior and its
public methods have `R = never`. React components cross the boundary through
one `runAppEffect` helper inside `useEffect`, but
`review-context.tsx` continues to own the state, reconciliation and persistence
badges. A browser-storage or served-state failure is logged inside the service
and deliberately becomes the existing fallback/failed product value. The helper
returns the Effect fiber interruptor, so React cleanup aborts pending browser
IO. Review writes share a one-permit semaphore, so rapid marks persist in state
order. Review controls remain disabled until the initial read has reconciled;
this prevents a late read from overwriting an optimistic mark and prevents
unflushed marks when navigation interrupts a stalled read.

The Phase 5 production build was measured against commit `8e82aca`. The
single-file export JS grew from 4,054,328 to 4,072,550 bytes (+18,222); Vite's
reported gzip size moved from 789.63 to 795.61 kB (+5.98 kB). The served entry
grew from 1,627,728 to 1,645,938 bytes (+18,210), with reported gzip from 514.04
to 520.44 kB (+6.40 kB). The export already carried Effect Schema; this delta is
the runtime, layers and typed browser workflows. It is accepted so the SPA uses
the same dependency, error and parsing model as the CLI without handing render
state to a second state system.

## The effectful shell has shared and session-scoped layer stacks

The CLI provides `cliLayer` once at its entry point. That layer holds Effect's
Node `FileSystem`/`Path` services, `CommandExecutor`, and `PrLocator`.
`CommandExecutor` deliberately still wraps `spawnSync`; process behavior and the
served payload-cache cost model stay unchanged. The resolver depends on that
process boundary rather than on Node's child-process API.

Repository selection happens after command parsing and may fetch a PR ref, so
the root-dependent `ServerRepo`, `PayloadCache`, and `ReviewStateStore` layers
cannot be constructed at process startup. `prepareSession` constructs each
parameterized layer once after selection and provides their merged session layer
once for that scope. Implementations capture the shared shell context while
their public service methods keep `R = never`. Tests use the same live shell
layer at real fixture seams and explicit test layers for fake repository/cache
seams.

Product file access goes through core `FileSystem` and path manipulation through
core `Path`; adapters translate `PlatformError` into their existing tagged
errors. The only `node:path` use left in the resolver is the pure cross-platform
repository-name parser, which must recognize Windows strings while running on a
different host.

## Core pipelines separate failures from report values

`loadWalkthrough`, `resolveContext`, `runCheck`, `runBuild`, `prepareSession`
and the four served API methods are named `Effect.fn` pipelines. They request
filesystem, path, command and repository capabilities through services. The
Markdoc parser, diff parser and document compiler remain ordinary pure
functions called by those pipelines; wrapping them in `Effect` would add an
execution model without adding a failure or dependency.

A file read, git command, export write or state-store failure stays in the
typed error channel until the boundary that can explain it. `check` is the one
deliberate translation: it turns `LoadError` into a `CheckDiagnostic` because a
complete report for every requested path is the command's product. An optional
`gh` enrichment failure also remains a warning in a successful resolve; git
still supplies the data needed to compile the walkthrough.

`check` uses `_tag` outcomes (`CheckPassed` / `CheckFailed`) for its strict
validation policy. Build and session preparation use their own `_tag` unions
and carry reports directly: an error diagnostic may still be renderable, while
a missing payload stops those commands. Terminal and HTTP reporting use
exhaustive `Match.valueTags` mappings, so adding a result or error variant
forces its reporting boundary to handle it. These tags never cross a JSON
edge: `check --json` still emits only `ok` and `reports`, while the four `/api`
response bodies keep their established shapes.

## Failures are tagged errors; absence is `Option`

Process execution, discovery, path resolution, review-state storage, loading,
building and served mode now expose per-area `Schema.TaggedErrorClass` unions.
Callers translate errors at their own boundary: `check` turns load failures into
`CheckDiagnostic` values, the CLI prints build and session failures, and the HTTP
edge maps `ApiError` tags to status codes. Diagnostics produced by parsing and
compilation still travel in successful `LoadResult` values.

`Option` means that nothing exists and the caller may continue: no state file,
no matching walkthrough state, an unreadable frontmatter envelope, or a git
probe that did not find a ref or blob. Corrupt JSON, unreadable files, failed
commands and writes are errors. In particular, `gitOut`, `parseReviewState` and
`resolveContext` no longer erase failures as `null`; the required served-app
bundle similarly fails as `AppBundleMissing` instead of returning a nullable
path.

Git absence is classified at the command that defines it. Quiet `rev-parse`,
`symbolic-ref` and `git config --get` map only their documented exit 1 to
`Option.none`; spawn failures and every other exit remain `CommandFailed`.
Walkthrough parsing collects the stamped file references before resolution,
which lets the resolver fetch those blobs effectfully and hand the pure compiler
a completed lookup map. No synchronous Effect runner hides behind
`ResolveContext.blob`.

The old state-store warning callback is gone. A failed state write reaches the
HTTP caller; the store itself logs failure to add `.balade/` to
`.git/info/exclude`, and the completed state write still succeeds. Index reads
do not degrade failures into omitted rows: repository or state failures reach
the HTTP error boundary. File watching is now a `FileSystem.watch` stream forked
into the session scope: the platform stream acquires and releases the OS watcher,
scope closure interrupts it, and late watcher failures go to the Effect runtime
logger. Any event invalidates the served walkthroughs in that directory; this
keeps editor rename saves correct without trusting an OS-specific event path.
The manual close and warning callbacks are gone. The SPA review-store service
likewise logs browser-storage and network failures in Effect before returning
its existing fallback outcome.

## `typecheck` carries the Effect language service

`@effect/tsgo` patches the native `tsc` binary in place — the `prepare` script
re-applies it after every install, and the plugin block in `tsconfig.json`
turns it on. Effect diagnostics therefore run inside `pnpm typecheck`:
error-level findings fail the build, suggestions print but do not (the
`ignoreEffectSuggestionsInTscExitCode` default). The patched binary must match
the installed TypeScript by gitHead, so the two packages move together — bump
`typescript` and `@effect/tsgo` in the same change.

## A PR target serves from `pull/<n>/head` when the branch is not checked out

`open <pr-url>` (spec #26, #27) looks in the working tree first; when the
walkthrough is not there, it fetches the PR's advertised ref and reads every
source as a blob at that commit. Three consequences are accepted: there is no
file watcher (content at a SHA is immutable — edits on the remote need a
reopen); the payload cache and staleness anchor on the fetched commit instead
of `HEAD`; and the fetch requires a GitHub origin — `pull/<n>/head` is a GitHub
refspec, and a failed fetch stops with a note. Review state is unaffected:
`.balade/` is keyed by walkthrough path, so marks made against a fetched ref
reappear when the branch is eventually checked out. The locator is an Effect
service (`src/pr/locate.ts`) with typed errors and captures the same filesystem,
path and command services as the rest of the shell.

## Resolution shells out through the `CommandExecutor` layer

The live layer still uses `spawnSync`. One resolve costs 2576 ms across 25
processes — fine for `check`, too slow to repeat per request. The decided path
is the synchronous adapter plus a
served-mode payload cache keyed `(sourcePath, pin, head)`, which turns repeat
requests into a map lookup. If the cache falls short, `execAsync` goes in beside
the synchronous implementation in `src/resolve/exec.ts`, behind the same
service.

`src/server/cache.ts` keeps one slot per walkthrough rather than one per key: a
payload carries the full contents of every changed file, and the head only moves
forward, so remembering the older heads would only grow. Keying costs one file
read and one `git rev-parse`; the watcher in `src/server/session.ts` drops the
slot when the file itself changes.

## Shiki ships fine-grained with a curated language map

The full shiki bundle is 11 MB; the fine-grained core plus 31 hand-picked
grammars is 3.9 MB. The static export inlines its assets, so bundle size is a
feature, not a preference. A language outside the map falls back to plain text —
adding one is a line in `app/src/highlight/shiki.ts`.

## The export bundle carries every grammar; the served one does not

`build` inlines the app into one HTML file, and a `file://` page has nowhere to
fetch a chunk from — so the export build (`vite build app --mode export`) turns
code splitting off and emits one JS and one CSS. All 31 grammars ride along:
3.97 MB of JS against the served build's 1.54 MB entry chunk, which loads a
grammar only when a payload names one. An exported walkthrough weighs about
4.0 MB, 766 kB gzipped, whatever it shows.

Two builds is the price of that difference. Serving the export bundle instead
would cost every reviewer the 2.4 MB of grammars they will not read; exporting
the served bundle would produce a file that only works next to its `assets/`
directory, which is not an export. What would move this: shipping fewer
grammars, or a payload-driven grammar subset — the language ids are known at
compile time, so `build` could bake only the ones a walkthrough uses, at the
cost of a per-walkthrough bundling step the CLI does not otherwise need.

## The inlined bundle is escaped, the baked payload is JSON-escaped

Both scripts in the export sit in HTML script data, where `</script` ends the
element and `<!--` opens an escaped state in which a later `<script>` makes the
closing tag stop closing. The payload is data: every `<` leaves as `\u003c`,
which is a JSON escape, so no walkthrough can end its own payload — prose about
HTML included. The bundle is code and cannot be re-encoded, so `src/build/html.ts`
inserts a backslash the JavaScript grammar ignores: `<\/script` and `<\!--`.
Both sequences can only occur inside a string, a template or a comment (an
unescaped `/` would close a regular expression literal), and `\!` under a `/u`
flag is a syntax error rather than a silent change of meaning. Today's bundle
holds eleven `<!--` and four `<script`, in grammar data and in react-dom, so
this is load-bearing, not defensive. Base64 in a `data:` URI would need no
escaping and would cost a third of the file size.

## The two `as` casts in `diff-highlighter.ts` are type-level, not data

`@git-diff-view/react` and `shiki` each carry their own copy of the `hast` `Root`
type. The casts bridge two structurally identical declarations; no unchecked
runtime value passes through them. They stay until the two packages agree on one
`hast` version.

## The odoo preset ships `o-field`; `o-security` enrichment is open

`o-field` and the decorator chips are live. `o-security` passes explicit `rows`
through to the core matrix — parsing `ir.model.access.csv` from the diff at the
pin and computing the rows is not done. `o-diagram` passes its attributes to the
core diagram transform; expanding `rel="m2o|o2m|m2m"` on edges into the standard
label, arrow kind and colour is not done either.

## Generation rides Pi as a hard dependency

`balade generate` drafts a walkthrough through the Pi coding-agent SDK
(`@earendil-works/pi-coding-agent`, exact-pinned like effect; verification
notes in [docs/research/pi-coding-agent-sdk.md](docs/research/pi-coding-agent-sdk.md)).
Pi is a hard dependency, not an optional peer: generation is the on-ramp, and
the first command a new user runs must work from a bare `npx balade`. The
install cost — roughly 13 MB unpacked plus the official provider SDKs on a
cold `npx` — is machine seconds and cacheable in CI. The live layer imports
Pi lazily (its root barrel loads TUI modules at import time), so `check`,
`open` and `build` never pay its startup cost. The effective Node range is
`^22.22.2 || ^24.15.0 || >=26.0.0`, covering Pi and its locked production tree;
Node 20 passed end of life on 2026-04-30.

Every Pi surface sits behind the one `WalkthroughAuthor` service, the
anti-corruption boundary for Pi's 0.x churn. What would move this: Pi's
Anthropic subscription path closing, in which case the same seam takes a
Codex-SDK-plus-API-key pair of adapters instead.

The adapter itself is split at the session boundary: `pi.ts` owns account,
authentication and global settings, while `pi-session.ts` owns the scoped
authoring session, its read-only tool policy and provider-event forwarding.
This keeps preference durability independent from the security-sensitive tool
sandbox and session lifecycle.

Provider/model defaults use Pi's global `SettingsManager` rather than a second
balade preference file. Project settings are not trusted or loaded for this
choice. A confirmed interactive selection updates Pi's default; a matching
default is reused without another picker. Every explicit or confirmed selection
updates that default. An exact `--provider` and `--model` pair skips the picker;
partial, empty, or unavailable values open it, narrowed to matching models when
possible. Preference read and write failures are typed warnings and do not
prevent a generation run.

The session runs in memory with a resource loader that exposes no Pi extensions,
skills, prompts, themes, global context, or working-tree context. It does expose
repository instructions from the pinned PR commit before the first turn. For
each changed path, the loader selects Pi's first matching `AGENTS.md` or
`CLAUDE.md` spelling at the root and each ancestor directory. This preserves
nested scope without putting unrelated monorepo instructions into the prompt,
and it cannot leak a different checked-out branch into analysis. Instruction
loading is outside the source-read budget; documents that an instruction names
are read through the normal pinned source tool and count toward that budget.

The allowlist contains only five balade-owned tools: list PR changes, list
pinned paths, read a pinned diff, read numbered lines from a pinned blob, and
submit the structured draft. The agent never receives Pi's shell or mutation
tools. `submit_walkthrough` ends the agent loop; the adapter stamps the schema
version, PR and commit after the model returns.

The baseline authoring turn is deliberately bounded to eight diff reads and
twelve source reads. The prompt asks for the behavioral spine in two to five
sections and normally three to eight focused ranges, with ten as a hard maximum.
These limits keep provider context and cost proportional to a review story
instead of rewarding an inventory of every changed file; richer curation remains
a separate quality layer. The read allowance resets for a repair turn so the
agent can verify a corrected range. The submit tool rejects drafts above the
range ceiling and asks the agent to focus the complete draft before accepting it.

A failed check gets at most two repair turns. Repairs use a new
`AgentSession.prompt()` in the same in-memory session, rather than Pi's queued
`followUp()`: a terminating tool leaves a tool-result message last, and
`agent.continue()` resumes that tool turn before it can drain the queued
follow-up. A fresh prompt puts the diagnostics and range echoes in the next
request without paying for an unprompted continuation. The first file write is
exclusive, so generation never overwrites an existing walkthrough; later
repairs replace only the draft created by that run. The last invalid draft stays
on disk after the repair budget is exhausted.

Generation consumes the resolver's canonical lightweight `PullSnapshot`; it
does not map that value into a second generation-only DTO. A remote pull head is
resolved with `ls-remote`, then the advertised object id is fetched with
`--no-write-fetch-head`; this pins the model and checker to one object without
racing other Git activity through `FETCH_HEAD`. Repair checks rehydrate their
context from that written pin with Git alone and never probe GitHub a second
time. Changed-file summaries stay lightweight until compilation asks for blob
content.

Output paths are repository-relative, exclude `.git`, and are checked through
their nearest existing canonical ancestor before any directory is created.
The first draft uses an exclusive create. Each repair is written to a temporary
file beside the draft and atomically renamed, so a failed write cannot truncate
the retained version. If a model or write fails during repair, the typed error
keeps both the file path and its last check report for manual recovery.

One semaphore owns each Pi session's turns, and the initial turn runs while the
scoped session is acquired instead of being exposed as a replayable effect.
Usage is decoded and reported after every completed provider turn, including
turns that end in provider or submission errors. Cancellation is distinct from
authentication failure. Cleanup skips abort for an idle session; an active
session abort is bounded and failures are logged without provider or credential
details. Model prose is not streamed in the default output, and every dynamic
terminal string has control sequences removed. By default, tool events collapse
to one message per inspection phase, and detailed tool results are not
materialized across the adapter boundary. `--verbose` opts into assistant-visible
text, every allowlisted tool input and result, and the successful range report;
provider-hidden reasoning remains hidden. A normal successful check prints only
the verified range count, generated path, and the next `balade open` command;
full diagnostics remain visible when the generated draft still needs manual
repair.

## Balade owns the versioned authoring package

The programmatic system prompt, section templates, rubric and inspection limits
ship in `src/generate/authoring.ts`. Balade is their single source because
`generate` must work from a bare npm install. The `code-walkthrough` skill is an
interactive wrapper: it points to the package contract and adds its human-agent
workflow, writing-skill review and visual diagram pass. It does not vendor a
second authoritative prompt or rubric.

The package uses semantic versions whose major equals the walkthrough schema.
Major bumps teach a new input contract, minor bumps can change authoring
decisions, and patches clarify wording without changing fixture expectations.
Generated files record the full version in the existing scalar metadata map as
`meta.balade-authoring`; the payload contract does not grow a provenance field,
and the CLI overwrites any model-supplied value for that reserved key.

Offline evaluation runs five change shapes through fixture Git repositories,
Pi's `fauxProvider`, the production adapter and `balade check`. This stays in
`pnpm test`. Live-provider comparison uses a separate paid Vitest config and
cannot run through the normal test command. The stable fixture decisions are
the comparison baseline for prompt revisions.

Walkthrough v1 Markdoc accepts double-quoted attributes only. Quote-heavy
values therefore use backslash escapes, such as
`decorator="@api.constrains(\"allocation_id\")"`; the older single-quote
prototype spelling is not part of the shipped grammar.

## Parser properties follow schema and grammar edges

The parser suite now exercises the five edges that warranted properties:
`parseFrontmatter`, review-state parsing, `loadPayload`, `splitDiff` and
`parsePo`. Review state, payload and frontmatter values come from Effect
Schema-derived arbitraries; the persisted values cross their JSON edges.
Unified diffs and gettext catalogs use focused grammar-aware generators and
serialize before parsing, including Git's adjacent file records and PO escape
sequences. The representative `app/src/fixtures/pr96.ts` payload also passes the
strict runtime schema in a test, so its compile-time annotation cannot hide
nested drift.

Property execution goes through `@effect/vitest`, which uses the `fast-check`
version re-exported by the pinned Effect beta; the project does not take a
second direct dependency. Effect-facing suites use `it.effect`, and converted
ports are exercised through layers: real fixture repositories for filesystem
state, and explicit in-memory layers for the server repository, payload cache,
browser fetch and storage seams.

## DOM tests cover the renderer's IO lifecycle

`render.test.tsx` still renders the whole fixture to a string. A focused jsdom
suite now crosses the browser runtime from `useReviewApi`: it exercises a click
while the initial load is pending, ordered persistence, and interruption on
unmount. The data suites continue to inject storage and fetch layers directly
for exhaustive adapter behavior.
