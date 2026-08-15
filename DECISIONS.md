# Decisions

Trade-offs this package has already weighed. Each entry states what holds today
and what would move it.

## The src/ layout is a folder-per-verb boundary over autonomous concept modules

Decided on [#37](https://github.com/basaltbytes/balade/issues/37). `src/` holds
one folder per CLI verb under `commands/`, the concept folders — `walkthrough/`
(the document, bytes to contract), `git/` (facts from the repository and forge),
`contract/` (shared vocabulary: shapes that cross module boundaries), `preset/`,
`authoring/` (the versioned authoring package: typed data plus its renderings),
`pi/` (the generation engine), `server/` (live session runtime) — and the root
files `cli.ts`, `shell.ts`, `state.ts`, `terminal.ts`, `failure.ts`, `presence.ts`.

All imports flow one direction; peers never import each other:

```
cli.ts                      entry + layer wiring
commands/    server/        orchestrators — the ONLY places concepts compose
pi/                         → authoring, git (type imports), contract, shell
walkthrough/                → preset, contract, shell        (never git/)
git/                        → contract, shell                (never walkthrough/)
preset/                     → contract
authoring/                  → nothing internal
contract/                   → nothing internal
shell.ts  state.ts  terminal.ts  failure.ts  presence.ts     root ports & utils → contract
```

1. `Command.make` appears only in `commands/<verb>/index.ts` (plus the root
   `balade` command in `cli.ts`). `ls src/commands` **is** the CLI surface.
2. A file lives in `commands/<verb>/` only if that verb is its sole importer.
   Nothing outside `commands/` may import from `commands/` (except `cli.ts`).
   The review lifecycle shared by `open` and a successful generation therefore
   lives in `server/review.ts`, not under either verb.
3. `walkthrough/`, `git/`, `preset/` are autonomous: they import only
   `contract/` and root ports (`walkthrough/` may additionally import
   `preset/` — the tag catalog is an extension of the format). Concepts compose
   only in `commands/` and `server/`, plus layer wiring in `cli.ts`.
4. Outside `commands/`, a concept with one file is a root file, not a folder.
5. Module files are nouns; verbs live in exports. The thing, not the action:
   `compiler.ts` exports `compileDocument`, `pipeline.ts` exports
   `loadWalkthrough`, `locator.ts` holds `PrLocator`. A file named after a
   phase (`load.ts`, `compile.ts`, `serve.ts`) misstates what it is.

The one seam that makes rule 3 hold: `contract/context.ts` owns the resolution
contract — `ResolveContext`, `ResolveOptions`, `ResolveResult`, a
`ContextResolver` service tag, and the process-port failure vocabulary
(`CommandFailed`, `NotARepository`, `CommitUnresolvable`). `walkthrough/pipeline.ts`
yields the service; `git/git.ts` provides the live layer wrapping the unchanged
`resolveContext`. The failure classes sit in the contract rather than `shell.ts`
because they cross every module boundary — `shell.ts` produces them, boundaries
translate them, and `contract/` must import nothing internal, in that order.

Enforced two ways: oxlint's `import/no-cycle` (import plugin, `.oxlintrc.json`)
rejects file cycles, and `test/architecture.test.ts` walks the real `src/`
import graph and asserts the rules above. What would move this: a second
renderer or a published API, which would force `contract/` to version.

## The payload contract is Effect Schema

Supersedes "the payload contract stays plain interfaces" (2026-08-02). The
source of truth is `src/contract/schema.ts`, with `src/contract/types.ts` derived
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

`src/contract/schema.ts` and `src/contract/review-parser.ts` are the pure shared
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

## Toned callouts derive their chrome from the tone

A `key` or `warn` callout renders through the app's shared banner shape: a
tone-colored icon, a localized heading, and the body. `key` uses a light-bulb
with “Key point” / “Point clé”; `warn` uses an alert icon with “Warning” /
“Attention”. Untoned callouts remain neutral asides without an icon or heading.

The title stays app chrome derived from `tone`. It does not enter the walkthrough
contract, so authors cannot supply a title and existing files need no change. An
author-provided title would change both the contract and the authoring catalog.

## The effectful shell has shared and session-scoped layer stacks

The CLI provides `cliLayer` once at its entry point (`src/cli.ts`, where the
former `live.ts` wiring now lives; `test/support/effect.ts` mirrors the same
stack explicitly so tests never import the executable entry). That layer holds
Effect's Node `FileSystem`/`Path` services, `CommandExecutor`,
`BrowserLauncher`, `PrLocator`, the Pi author adapter, and the live
`ContextResolver`.
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
and the six served API methods are named `Effect.fn` pipelines. They request
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
edge: `check --json` still emits only `ok` and `reports`, while the six `/api`
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

The CLI catches typed failures directly at its presentation boundary; it does
not turn a failed command, read or write into an empty `Option` to stop control
flow. Pull-head lookup likewise preserves `CommandFailed` from `ls-remote`,
`fetch` and commit resolution instead of relabelling every cause as a missing
pull ref. Read adapters keep their external cause, and terminal renderers name
that cause and the exact source or bundle file that failed.

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
service (`src/commands/open/locator.ts`) with typed errors and captures the same filesystem,
path and command services as the rest of the shell.

The locator and review selection model working-tree and fetched-head sources as
separate variants. A fetched-head selection therefore always carries both its
PR number and commit; neither can appear as optional baggage on a working-tree
selection.

## Resolution shells out through the `CommandExecutor` layer

The live layer still uses `spawnSync`. One resolve costs 2576 ms across 25
processes — fine for `check`, too slow to repeat per request. The decided path
is the synchronous adapter plus a
served-mode payload cache keyed `(sourcePath, pin, head)`, which turns repeat
requests into a map lookup. If the cache falls short, `execAsync` goes in beside
the synchronous implementation in `src/shell.ts`, behind the same
service.

`src/server/cache.ts` keeps one slot per walkthrough rather than one per key: a
payload carries the full contents of every changed file, and the head only moves
forward, so remembering the older heads would only grow. Keying costs one file
read and one `git rev-parse`; the watcher in `src/server/session.ts` drops the
slot when the file itself changes.

## `open` launches the browser through its own detached process port

`balade open` opens the served URL in the default browser (issue #21) through
`BrowserLauncher` in `src/server/browser.ts`, not through `CommandExecutor`:
the synchronous adapter blocks the event loop, and a Linux opener that stays
attached to the browser it starts would freeze the server it was launched for.
The launcher spawns the platform opener detached and waits a short verdict
window — a fast non-zero exit (missing binary, no display, no handler) becomes
a typed `BrowserLaunchFailed`, while an opener still running after the window
counts as launched and is left behind, unreferenced. The command boundary
prints the launch failure as a warning with the URL and keeps serving;
`--no-browser` skips the spawn entirely. Tests inject fixture opener commands
through `BrowserLauncher.layerWith`, so the suite exercises the real spawn
seam without opening a browser.

## Pull-request shorthand leads with bare numbers

`generate` and `open` accept a pull-request URL, bare digits, or `#` followed by
digits. Public usage and command help lead with bare digits such as `96`; the
`#96` form appears only as `'#96'` because interactive zsh treats an unquoted
`#` as the start of a comment. The parser keeps accepting both forms for quoted
arguments and programmatic callers.

Zero-argument `open` remains the discovery workflow. Once discovery succeeds,
the CLI announces that no target was given and prints the number of discovered
walkthroughs before the server URL. This makes a shell-stripped target visible
without requiring an `--all` flag or guessing whether the user intended an
argument.

## A passing generation enters the live review pipeline

`balade generate` now hands a checked draft directly to the same prepared-session,
server and `BrowserLauncher` path as `balade open`. The authoring session closes
before the review server starts; the long-lived server remains owned by the CLI
scope. `--no-browser` keeps that session headless, while `--no-open` is the explicit
generate-and-exit mode for scripts and CI and preserves the generated path plus
`balade open …` hint. A draft that still has check errors never reaches session
preparation, so its retained-file and non-zero-exit behavior is unchanged.

## Shiki ships fine-grained with a curated language map

The full shiki bundle is 11 MB; the fine-grained core plus 31 hand-picked
grammars is 3.9 MB. The static export inlines its assets, so bundle size is a
feature, not a preference. A language outside the map falls back to plain text —
adding one is a line in `app/src/highlight/shiki.ts`.

## The export bundle carries every grammar; the served one does not

`build` inlines the app into one HTML file, and a `file://` page has nowhere to
fetch a chunk from — so the export build (`vite build app --mode export`) turns
code splitting off and emits one JS and one CSS. All 31 grammars and the whole
mermaid renderer ride along: 7.48 MB of JS against the served build's 1.65 MB
entry chunk, which loads a grammar or mermaid only when a payload needs one.
An exported walkthrough weighs about 7.5 MB, 1.72 MB gzipped, whatever it
shows, and the export build's chunk-size warning is the expected cost of the
single file.

Two builds is the price of that difference. Serving the export bundle instead
would cost every reviewer the 2.4 MB of grammars they will not read; exporting
the served bundle would produce a file that only works next to its `assets/`
directory, which is not an export. What would move this: shipping fewer
grammars, or a payload-driven grammar subset — the language ids are known at
compile time, so `build` could bake only the ones a walkthrough uses, at the
cost of a per-walkthrough bundling step the CLI does not otherwise need.

## Untrusted rendering work is bounded where it becomes expensive

Decided on [#74](https://github.com/basaltbytes/balade/issues/74). Syntax
highlighting never sends a line longer than 2,000 characters through a grammar.
A code excerpt with such a line renders through React's escaped text path and
shows a localized note. The diff adapter sends the whole file through Shiki's
plaintext grammar instead; `text` counts as registered even though Shiki omits
special languages from `getLoadedLanguages()`. Diff highlighting stays disabled
until that adapter is ready, so `@git-diff-view` never gets a chance to run its
bundled `highlightAuto` fallback over PR bytes.

Shiki loading is a browser `SyntaxHighlighter` service in the app's single
managed runtime. Chunk/grammar failures, registry inspection failures and
synchronous render failures keep their external cause in distinct tagged
errors; the boundary logs them before choosing the existing plaintext outcome.
The diff library requires a
synchronous `getAST`, so that one adapter uses `Result.try` instead of hiding an
Effect runner in a callback. Its failure AST is a root containing only the raw
text node: it preserves the diff while adding no content-derived properties.

Diagram coordinates are clamped to 1–64 in the CLI transform and again in the
renderer. The first boundary keeps generated payloads small and valid; the
second protects ref-mode and exported payloads that did not pass through that
transform. A 64×64 grid already exceeds a readable walkthrough diagram, while
bounding the renderer to 4,096 cells.

The payload schema remains shape-only. These limits belong to the consumers
whose cost they bound, so no contract field or compatibility path is added.
The same consumer-boundary rule makes frontmatter key lookup literal instead of
regular-expression based, and terminates `git rev-parse` options before a
PR-controlled ref name.

## Export and served pages declare separate content-security policies

Decided on [#67](https://github.com/basaltbytes/balade/issues/67). The static
export puts a CSP meta element before either inline script. It sets
`default-src 'none'`, admits only inline script and style, permits data images,
and forbids programmatic connections, frames, form actions and base URLs. The
inline script permission is explicit because an omitted `script-src` would inherit
`default-src 'none'` and stop the app from rendering.

The served Vite page owns a different meta policy: scripts and styles may load
from its origin, inline styles remain available to the renderer, and
`connect-src 'self'` admits the `/api/*` requests. The policies stay at their
two HTML generation boundaries rather than sharing a constant, so a future
network need in served mode cannot silently weaken exports. `frame-ancestors`
is absent because browsers ignore it in a meta policy; the real response header
belongs to the server hardening in #63.

An export still embeds the complete old and new contents of every changed file.
`build` reports that file count and the README inventories the source and
metadata before users share the HTML. Export review state stays resumable in
`localStorage`; the README also records the `file://` partition exposure and
the dedicated-origin option instead of weakening persistence.

## The review server validates its authority before routing

Decided on [#63](https://github.com/basaltbytes/balade/issues/63). Every routed
request passes through one global middleware that accepts only `127.0.0.1`,
`localhost` or `[::1]`, with an optional numeric port. Loopback binding alone
does not stop DNS rebinding: a rebound page can connect to `127.0.0.1`, but its
`Host` header still names the attacker's origin. Missing, malformed and other
hosts therefore receive `403` before the static app or an API handler runs.

Once a host passes, the same middleware adds `X-Frame-Options: DENY` to the
response so another site cannot frame the served review UI. This is a
response-header control and stays separate from the export's meta CSP, which
browsers cannot use to enforce `frame-ancestors`.

Only `PUT /api/state` reads a request body. Its JSON read provides Effect's
`MaxBodySize` with a 4 MiB limit; an oversized body follows the existing invalid
review-state response and leaves the process alive. The limit is generous for a
review state while staying far below the Node string-size failure found during
the security audit.

API failures retain their original cause as `Schema.Defect()` until one shared
HTTP translation pipeline handles them. That boundary logs internal `500`
failures with Effect's complete nested cause rendering after terminal-control
sanitization, then returns a stable public message; exception text and absolute
paths never enter an HTTP response. Expected `400` and `404` outcomes remain
typed recoveries and are not logged as server failures.

## The inlined bundle is escaped, the baked payload is JSON-escaped

Both scripts in the export sit in HTML script data, where `</script` ends the
element and `<!--` opens an escaped state in which a later `<script>` makes the
closing tag stop closing. The payload is data: every `<` leaves as `\u003c`,
which is a JSON escape, so no walkthrough can end its own payload — prose about
HTML included. The bundle is code and cannot be re-encoded, so
`src/commands/build/html.ts` uses escapes the JavaScript grammar preserves:
`<\/script` and `\x3c!--`. The hex escape also works inside Unicode regular
expressions and inside strings that are later compiled as regular expressions;
the older `<\!--` spelling made both forms invalid under the `/u` flag. Today's
bundle holds eleven `<!--` and four `<script`, in grammar data and in react-dom,
so this is load-bearing, not defensive. Base64 in a `data:` URI would need no
escaping and would cost a third of the file size.

## The two `as` casts in `diff-highlighter.ts` are type-level, not data

`@git-diff-view/react` and `shiki` each carry their own copy of the `hast` `Root`
type. The casts bridge two structurally identical declarations; no unchecked
runtime value passes through them. They stay until the two packages agree on one
`hast` version.

## Code excerpt diffs use absolute synthetic hunks

The plain, change and diff views of a `code` block all number an excerpt from
its absolute `from` line. The diff payload only identifies changed lines in the
new file and cannot recover their pre-image coordinates, so the synthetic old
side starts at `from` too. This anchors both sides to the same absolute range
and avoids an excerpt-local offset; old-side numbers are explicitly not
historical positions.

The code widget gives `@git-diff-view` the hunk and file metadata without the
excerpt as file content. The renderer then composes both sides from the hunk,
preserving its absolute coordinates and suppressing the placeholder rows before
`from`. This also disables context expansion, which is correct: a code block
does not carry the surrounding file and cannot honour an expansion request.

Hunk-only composition cannot represent an excerpt the overlay leaves untouched:
both sides compose to the same text and the parser drops the diff, rendering an
empty view. `codeExcerptHunk` returns `null` for such an excerpt and the widget
shows the plain rendering in the diff view's place — the same lines, the same
absolute numbers, and no pretence of a change that is not there.

## A preset is activated explicitly, and owns the prose that teaches it

`generate --preset <name>` is the only way generation activates a preset
(2026-08-05). Two things follow from the flag: the preset's own authoring text
goes into the system prompt, and the CLI stamps `preset:` in the frontmatter so
the tags are active when `check` reads the draft. An explicit flag outranks any
`preset` the model returned, and without the flag the prompt tells the model not
to set one — before this, the prompt mentioned "an optional preset" without ever
naming a preset or its tags, so `generate` could not realistically produce one.

Each `Preset` carries its own `authoring` string. That keeps preset knowledge in
`preset/`, which the dependency law forbids `pi/` from importing: the command
boundary reads the registry and passes `{ name, authoring }` through the
`AuthoringPreset` boundary type, so the generation engine stays preset-agnostic.
The cost is that the guidance is hand-written prose rather than derived from the
Markdoc schemas — the schemas carry attribute names and types but not when a tag
earns its place, which is the part a model gets wrong. Adding preset guidance is
a minor authoring-package bump (1.4.0): a new authoring decision, no change to
the input contract, and fixtures that name no preset are unaffected.

Detection is deliberately not done. Sniffing `__manifest__.py` to auto-activate
`odoo` would guess at a repository-wide choice from one file; what would move
this is a preset the author would always want, where the flag becomes friction.

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

`@effect/platform-node-shared` is pinned as a direct dependency even though
balade never imports it. `@effect/platform-node` declares it with a caret
range, so a fresh npm install of the published package resolves the newest
beta, whose `effect` peer pulls a second effect runtime into the tree and
kills the CLI at startup (caught by the npm-package smoke job, 2026-08-04).
The explicit pin makes npm dedupe onto the version balade's own `effect` pin
matches. Bump it in lockstep with every effect-family bump; drop it when the
Effect v4 packages stabilize their internal ranges.

Every Pi surface sits behind the one `WalkthroughAuthor` service, the
anti-corruption boundary for Pi's 0.x churn. What would move this: Pi's
Anthropic subscription path closing, in which case the same seam takes a
Codex-SDK-plus-API-key pair of adapters instead.

The adapter itself is split at the session boundary: `pi/client.ts` owns
account, authentication and global settings, while `pi/session.ts` owns the
scoped authoring session, its read-only tool policy and provider-event
forwarding. `pi/project-context.ts` owns repository-instruction selection and
the system-prompt trust boundary. Project-context loading composes the pinned
snapshot's typed effects directly. Session preparation stays inside the
`WalkthroughAuthor.start` Effect, preserving snapshot and project-context
failures as typed errors and translating search-configuration failures at the
filesystem boundary. Only calls into Pi's Promise-based SDK cross through
`Effect.tryPromise`; unknown SDK exceptions become `AuthorSessionStartFailed`.
The immutable snapshot memoizes
its source-file listing as an Effect and shares it with Pi's Promise-based tool
callbacks, where the runtime boundary belongs.
This keeps preference durability independent from the security-sensitive tool
sandbox and session lifecycle.

Balade points Pi at its own agent directory, `~/.balade/pi/` — `auth.json`,
`settings.json`, `models.json` and Pi's derived `models-store.json` all live
there, passed explicitly to `ModelRuntime.create` and `SettingsManager.create`.
The home dot-directory is deliberate on every platform: it mirrors Pi's own
`~/.pi` convention rather than `%APPDATA%` or XDG paths, so the two stores sit
side by side and are equally easy to find and delete. Balade never reads or
writes `~/.pi/agent/`: a user's own pi CLI must not observe a balade run, and
the earlier choice of Pi's global settings file silently changed that CLI's
default model (revised 2026-08-04, issue #27). The accepted cost is one extra
login for users who already authenticated the pi CLI. Project settings are not
trusted or loaded for this choice. Picking a model in the picker is itself the
confirmation: generation starts directly, with no second confirm prompt
(revised 2026-08-04, issue #25). An interactive selection updates balade's
saved default; a matching default is reused without another picker. Every
explicit or interactive selection updates that default. An exact
`--provider` and `--model` pair skips the picker; partial, empty, or
unavailable values open it, narrowed to matching models when possible.
Preference read and write failures are typed warnings and do not prevent a
generation run.

The session runs in memory with a resource loader that exposes no Pi extensions,
skills, prompts, themes, global context, or working-tree context. It exposes
repository instructions from the pinned PR commit before the first turn. For
each changed path, the loader selects Pi's first matching `AGENTS.md` or
`CLAUDE.md` spelling at the root and each ancestor directory. This preserves
nested scope without putting unrelated monorepo instructions into the prompt,
and it cannot leak a different checked-out branch into analysis. Instruction
loading is outside the source-read budget; documents that an instruction names
are read through the normal pinned source tool and count toward that budget.

Decided on [#61](https://github.com/basaltbytes/balade/issues/61): an instruction
file the PR adds or edits is a claim until a human explicitly passes
`--trust-head-instructions`. Balade omits it by default and reports the path;
unchanged instructions retain the existing behavior. Loading the base version
was rejected because a PR that intentionally changes its instructions must be
testable under the new rules. Interactive confirmation was rejected because
`generate` remains scriptable. The CLI flag becomes an explicit
`omit-changed | trust-changed` policy at the command boundary instead of sending
a behavior-switching boolean through the generation pipeline. A project-context
closing tag always rejects the file with a notice, even when the file is
otherwise trusted, and attribute characters in its untrusted repository path
are escaped before Pi interpolates the path into the system prompt.

The allowlist contains only seven balade-owned tools: list PR changes, list
pinned paths, search pinned source, read a pinned diff, read numbered lines at
the pin or base, and submit the structured draft. The agent never receives Pi's
shell or mutation tools. `submit_walkthrough` ends the agent loop; the adapter
stamps the schema version, PR and commit after the model returns.

Pinned source inspection is filesystem-backed (revised 2026-08-04, issue #28).
After the resolver fetches the PR head object, `git archive` extracts that pin
under `~/.balade/cache/snapshots/`, keyed by a repository-root digest and the
full object id. The snapshot's `tree/` contains only archived Git content: cache
metadata stays beside it, and no `.git`, history, other branch, or working-tree
state is present. Listing and reads use that filesystem; search wraps Pi's
managed ripgrep inside a balade-owned tool. Every caller-supplied scope resolves
canonically below the snapshot root before use, and every search runs under a
balade-owned ripgrep configuration (`--no-ignore`, `--no-follow`) that replaces
any user-level `RIPGREP_CONFIG_PATH`: a user's ripgrep defaults cannot follow a
symlink out of the snapshot or filter matches, and the pin's committed ignore
files stay inert even when the cache directory sits inside a git repository.
Base reads remain `git show base:path`, so the old side does not require a
second extraction.

The disk and extraction cost buys repository-wide discovery at the exact pin.
Repeat and repair turns reuse complete entries, which are built in a sibling
temporary directory and atomically renamed so concurrent sessions do not see a
partial tree. Each open updates access metadata outside `tree/`; a global LRU
keeps five entries and deletes older ones. This bounds retained disk while
preserving the common repeat-run cache hit.

The baseline authoring turn is deliberately bounded to eight diff reads and
twenty searches plus twelve source reads shared across pin and base. Search gets
the larger allowance because a capped match list makes the following reads more
targeted. The prompt asks for the behavioral spine in two to five sections and
normally three to eight focused ranges, with ten as a hard maximum. These limits
keep provider context and cost proportional to a review story instead of
rewarding an inventory of every changed file. All inspection allowances reset
for a repair turn so the agent can verify a corrected range. The submit tool
rejects drafts above the range ceiling and asks the agent to focus the complete
draft before accepting it.

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
racing other Git activity through `FETCH_HEAD`. Repair checks pass the
snapshot's already-resolved base and head through the check pipeline, rehydrate
their content from Git, and never derive a replacement range from the current
checkout or probe GitHub a second time. This keeps a merged pull request tied to
the range the author inspected instead of collapsing its base to the merged pin
([#116](https://github.com/basaltbytes/balade/issues/116)). A discriminated
`PullResolution` makes a fetched head and a prepared range mutually exclusive at
the resolver boundary. Changed-file summaries stay lightweight until
compilation asks for blob content.

Generated walkthroughs default to `.agents/walkthroughs/` (revised 2026-08-05):
a walkthrough is an agent-authored artifact, and grouping it with the other
agent-facing files keeps it out of the way of the source tree a reviewer reads.
The location is a default, not a convention change — discovery still matches
git-tracked `**/walkthroughs/*.md` at any depth, so the dot-directory is found
by the same rule as a root `walkthroughs/`, and `--dir` still overrides it.

Output paths are repository-relative, exclude `.git`, and are checked through
their nearest existing canonical ancestor before any directory is created — and
before the paid turn, so a bad `--dir` never costs a model run.

The overwrite decision also resolves pre-flight, never at write time
([#134](https://github.com/basaltbytes/balade/issues/134), revising the
collision policy #100 shipped). Conflict detection binds to (PR, lang) read
from each existing `pr-<n>-*.md` stamp, not to the exact filename — the
filename is unknowable before the model titles the draft, and an `en` and an
`fr` walkthrough for the same PR never conflict. A file stamped at an older
head is announced (`Refreshing … (old → new)`) and superseded without a prompt
or flag; a file stamped at the current head — or with an unreadable stamp,
which cannot prove a different identity — asks on a TTY and refuses at t=0 in
non-interactive runs, where `--force` survives solely as the skip-prompt
escape. The completed draft writes through the same temporary-file-and-rename
path as repairs, then superseded same-identity files with a different slug are
removed, so a re-rolled title cannot leave a stale duplicate. Hand-edit safety
moved from refusal to retention: content reachable in git needs no copy, while
dirty or untracked superseded content is first copied to `<file>.superseded` —
a fixed name, so retention stays bounded and outside `.md` discovery. The write
path can no longer fail on a collision, so the check-and-repair loop always
runs and no message ever advises paying for a second turn. This overturns
#100's Addendum 1 (drift did not auto-overwrite) and deletes its
recovered-draft sidecar. Each repair is also written to a temporary file
beside the draft and atomically renamed, so a failed write cannot truncate the
generated version. If a model or write fails during repair, the typed error keeps
both the file path and its last check report for manual recovery.

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
provider-hidden reasoning remains hidden. A normal successful generation prints
the verified range count and generated path before entering the live review
session. `--no-open` additionally prints the next `balade open` command and exits;
full diagnostics remain visible when the generated draft still needs manual repair.

## Authoring containment blocks credential reads and owns process search configuration

Decided on [#59](https://github.com/basaltbytes/balade/issues/59). Source reads
keep repository-wide context, including unchanged neighbouring files, because
that context is part of useful walkthrough generation. The narrower boundary is
a case-insensitive credential-path denylist shared by `read_source` and
`read_base_source`: environment files, package and network auth files, private
key formats, credential/secret names, and paths below `.aws/`, `.ssh/` or
`.gnupg/` all fail through the same contained-path error. The pure gate decodes
to a branded `AuthorSourcePath` in an Effect `Result`; rejection is an
`AuthorSourcePathRejected` tagged error until Pi's Promise tool boundary turns
it into the tool error the SDK requires; a missing pinned file follows the same
path as `AuthorSourceUnavailable`. A prompt rule is only defence in depth: it
tells the agent to describe a credential-bearing change without quoting the
value and to make the omission visible to the reviewer.

Cross-repository closing issues are still fetched. Legitimate projects keep
requirements in central repositories, so silently dropping the text would lose
useful context. The reference instead carries a same-repository or third-party
variant from the `gh pr view` boundary onward. Same-repository claims retain the
author-stated-intent framing; third-party claims render under their own untrusted
heading and emit a notice naming the source repository. PR and issue URLs parse
once through Effect Schema into repository locations before classification. A
malformed location rejects the optional `gh` enrichment with its existing
notice; it never falls back to presenting an arbitrary URL as a repository.

Pi spawns ripgrep from concurrent tool calls with the process environment and
offers no per-spawn `env` seam. The balade-owned `RIPGREP_CONFIG_PATH` is
therefore set once when the session is created and is never restored. The CLI
spawns ripgrep only through Pi, so leaving the configuration installed removes
the race without taking a lock or serializing independent searches. The global
write remains a named `Effect.sync` boundary rather than an untracked mutation
inside session assembly.

## Balade owns the versioned authoring package

The section templates, tag catalog, rubric and inspection limits ship as typed
data in `src/authoring/`; `src/pi/authoring.ts` renders them into the
programmatic system prompt. Balade is their single source because `generate`
must work from a bare npm install. The `code-walkthrough` skill is an
interactive wrapper: it points to the package contract and adds its human-agent
workflow, writing-skill review and visual diagram pass. It does not vendor a
second authoritative prompt or rubric.

The package uses semantic versions whose major equals the walkthrough schema.
Major bumps teach a new input contract, minor bumps can change authoring
decisions, and patches clarify wording without changing fixture expectations.
Generated files record the full version in the existing scalar metadata map as
`meta.balade-authoring`; the payload contract does not grow a provenance field,
and the CLI overwrites any model-supplied value for that reserved key.

Author-stated intent also stays outside the renderer payload contract. The
generation snapshot carries the PR title and body, linked closing-issue text,
and at most 20 commit subjects from `base..pin`. `gh pr view` provides the PR
claims and linked-issue references; generation resolves each reference through
the same optional `gh` process seam because the reference JSON does not include
issue text. A failed GitHub lookup remains a carried `gh-unavailable` notice,
while Git still supplies the capped commit subjects. The prompt labels every
intent string as untrusted author-controlled claims, forbids following embedded
instructions, and requires pinned evidence for any stated agreement or
divergence.

Offline evaluation runs five change shapes through fixture Git repositories,
Pi's `fauxProvider`, the production adapter and `balade check`. This stays in
`pnpm test`. Live-provider comparison uses a separate paid Vitest config and
cannot run through the normal test command. The stable fixture decisions are
the comparison baseline for prompt revisions.

Walkthrough v1 Markdoc accepts double-quoted attributes only. Quote-heavy
values therefore use backslash escapes, such as
`decorator="@api.constrains(\"allocation_id\")"`; the older single-quote
prototype spelling is not part of the shipped grammar.

## The authoring skill is generated and self-installed

Decided on [#43](https://github.com/basaltbytes/balade/issues/43). The typed
authoring data renders a second time as a `SKILL.md`, and `balade skills
install` places it in `.agents/skills/` at the repo root — the shared
convention that covers Codex, opencode, Cursor, recent Claude Code, and most
others, per vercel-labs/skills' agent registry — plus `.claude/skills/` when
`.claude/` already exists, so a repository that never uses Claude Code never
grows the folder. Installation is not delegated to that external installer:
it has no version pinning, no origin lockfile, and no npm-name sources, so a
delegated refresh loop diverges — an older CLI's "re-install" hint would fetch
an even newer skill. Self-install converges by construction: the skill is
rendered from the installed CLI's own data, so the frontmatter stamp always
matches. The escape hatch for tail-agent layouts is `--out <dir>` plus the
`dist/skill/` rendering in the npm package, which a path-based
`npx skills add` can place; the path points at the installed package, so
versions still converge.

The typed data stays TypeScript: CI parse-validates every catalog example
against the real Markdoc config, which a hand-edited `.md` source could not
guarantee. The prose lives in Markdown documents beside the renderers (see
"Authoring prose lives in Markdown documents" below). The generated SKILL.md
is never edited — install always overwrites. Prose that both renderings state
verbatim lives once in `src/authoring/guidance.md` and is interpolated by
each, so the prompt and the skill cannot drift sentence-by-sentence; only
rendering-specific prose (the Pi tool contract in `src/pi/system-prompt.md`,
the skill's authoring loop in `src/authoring/skill.md`) is written per
renderer.

The staleness guard lives in `check` at the command boundary
(`commands/check/skill.ts`), not in the checker: it scans both conventional
directories for a `balade-authoring:` frontmatter stamp and prints one stderr
hint on a version mismatch. Stderr keeps `--json` stdout parseable; the hint
is never a diagnostic and never the exit code, because the skill is optional
and `check`'s fix hints already teach an agent without one. Agent detection
(`@vercel/detect-agent`) was rejected: it names the agent running the current
process, not the agents a repository serves. The repository itself is the
evidence install keys on — an existing `.claude/` folder.

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
unmount. Because that suite crosses the app's `ManagedRuntime`, it runs through
`@effect/vitest` `it.effect`; React's Promise-only `act` and polling boundaries
enter through `Effect.promise`. The data suites continue to inject storage and
fetch layers directly for exhaustive adapter behavior.

## In-page navigation never assumes smooth scrolling runs

The first visual pass in a real browser (2026-08-03) found `jumpTo` dead in
environments where smooth scrolling is disabled (browser flag or accessibility
setting): Chrome drops the animated `scrollIntoView` outright instead of
degrading it. `jumpTo` still asks for the smooth scroll, then watches one frame
pair and jumps without the animation when nothing moved. Hard loads honour the
URL hash from the walkthrough route — the sections exist only after React
renders, so the browser's native anchor jump has nothing to hit — with one
corrective jump after Shiki hydration reflows the content above the target.

Diagram edge labels sit at the midpoint of the edge's *visible run* (between
the two node borders, measured after layout), not the raw center-to-center
midpoint, which lands under a node box whenever two connected boxes are
adjacent. A label whose visible run is shorter than its chip renders above the
boxes instead of being sliced by them. This stays label placement on straight
lines — the "no routing engine" stance holds; what would move it is curved or
multi-segment edges.

## The base prompt teaches the core tag catalog

Authoring package 1.5.0. Earlier prompts named the fifteen core tags in one
sentence and documented only `code`, so drafts avoided every block whose
attributes the model would have had to guess — most visibly `diagram` — and
fell back to prose. The odoo authoring text even addressed a model "that
already knows the core catalog", which nothing taught. The observed cost was
walkthroughs poorer than the pre-balade skill output: no diagrams, no field
tables, no test cards.

The system prompt now shows one exact example per block plus the full diagram
node and edge shape, and states the cost model out loud: only `code` ranges
count against the range budget, so structured blocks are free, and enumerable
content should prefer a block over a prose list. The catalog costs a few
hundred prompt tokens on every run; teaching tags through repair turns instead
costs a full check round-trip per guessed attribute.

The catalog is authored, not derived from the tag schemas: the value is the
judgment prose and realistic examples, and the prompt is a versioned artifact
that must not drift silently with code. The guard runs the other way — the
catalog and the odoo authoring text keep their examples in typed structures
(`AUTHORING_TAG_CATALOG`, `ODOO_AUTHORING_EXAMPLES`) interpolated into the
prompt, and tests parse every example through the real `parseDocument` config,
so a wrong attribute fails CI instead of teaching every draft a repair turn.
A test also walks `CORE_TAG_NAMES` so a tag added to the format cannot
silently stay untaught, and the docs must contain the current package version.
Presets still teach only their own tags on top of the taught core; the odoo
preset adds a what-to-hunt checklist mapping Odoo anatomy (models, fields,
views, wizards, security, i18n, tests) to the block each belongs in, and its
diagram guidance asks for the changed relations instead of warning away from
the tag.

## File-sections are taught, and `generate --lang` decides the authored language

Authoring package 1.6.0. The nav always supported GitHub-style file entries —
`section file="…"` compiles to a `kind: "file"` nav node with the status color
and keeps its review checkbox — but generated drafts never used the attribute
because the prompt taught sections only through the bare templates. The catalog
now carries a file-section entry (file, nav, related), so generated
sidebars can read like a changed-file list without any renderer change.
The owner's framing (2026-08-06): the base package teaches capabilities
neutrally and leaves the use to the author's per-section judgment — many
walkthroughs need no file-section at all; a preset is where an opinionated
push belongs (the odoo checklist asks for file-sections on model files).

Two boundary fixes rode along, caught in review before the attribute shipped
taught. The section attribute `relatedFiles` held section *ids* rendered as
jump chips — the schema comment admitted it — so a model taught "files" would
emit paths and produce dead links. It is renamed to `related` (a deliberate
payload-contract change; nothing committed used it), and the compiler now
verifies every `related` id names a section in the document
(`related-section-unknown`), forward references included. And the `"en" | "fr"`
union, previously spelled inline at ten sites, is now the exported `Lang`
schema/type in `contract/` — the app's `i18n.ts` re-exports it, so adding a
language is a one-line contract change plus dictionaries.

Language: `open`/`build --lang` stays a render-time chrome override, while
`generate --lang en|fr` decides what the author writes — the initial request
gains a language instruction and balade stamps `meta.lang`. The flag outranks
a model-supplied `meta.lang`, mirroring the preset rule; without the flag,
drafts stay English and a model-supplied value stands. The instruction lives in
the initial request, not the system prompt, because it is per-run input, not a
versioned authoring decision.

Reviewer steering ([#103](https://github.com/basaltbytes/balade/issues/103)):
`generate --prompt` appends operator-typed guidance to the initial request in
its own labeled block after the untrusted claims — the explicit inverse of
their trust framing. It follows the same law as the language instruction:
per-run input lives in the request, never in the versioned system prompt, so it
stacks with `--preset` by construction and survives repair turns through
session history. The guidance is deliberately not stamped into the frontmatter:
the walkthrough is committed and shared, while steering notes are
operator-private. An all-whitespace value is treated as absent at the CLI
boundary.

## Code excerpts deep-link to the PR diff without changing the payload

Decided on [#45](https://github.com/basaltbytes/balade/issues/45). Every code
header carries one discreet external link to
`<pr.url>/files#diff-<sha256(file)>R<from>`. The PR diff is the target rather
than a pinned blob because the reviewer is jumping out to inspect context and
comment; a second blob link would make the small header affordance compete with
the view switcher.

The app computes GitHub's path hash through Web Crypto. The served loopback URL
and self-contained `file://` export are secure contexts, so both modes can use
`crypto.subtle` without adding a hash to the CLI/app payload contract. The link
renders immediately as `<pr.url>/files` for SSR, first paint, and environments
without Web Crypto, then upgrades to the file and right-side line anchor. A
hash failure therefore loses precision but never loses the route to the PR's
files tab. GitHub may lazy-load a large diff before its fragment exists; landing
on the files tab is the accepted fallback.

## Every walkthrough ends with the unfiltered full-PR diff

Decided on [#46](https://github.com/basaltbytes/balade/issues/46). The final
section of every walkthrough contains an attribute-free `{% files /%}` block.
It gives the reviewer every changed file, expand-context controls and the
per-file Viewed checkboxes after the narrative reading path. Filtered `files`
blocks remain available inside earlier narrative sections, but they do not
satisfy the closing rule.

The authoring package teaches the closing group as a mandatory structural rule
and scopes anti-inventory guidance to narrative sections. The compiler
enforces the same rule as an error so `check` rejects drift and generation can
repair it. What would move this: a replacement closing widget that preserves
the complete diff and per-file review-state behavior without a `files` block.

## Publish stays in release.yml; changesets only versions and tags

Decided on [#49](https://github.com/basaltbytes/balade/issues/49). Changesets
owns the bookkeeping: PRs carry changeset files, `changesets.yml` maintains the
rolling Version Packages PR and, once it merges, pushes the `v*` tag and
dispatches `release.yml` on it. Publishing itself never moves out of
`release.yml`, because npmjs.com pins that exact workflow file as the package's
trusted publisher — OIDC, no NPM_TOKEN anywhere — and relocating the publish
step would mean re-registering the trusted publisher for zero gain. The
dispatch is explicit (`gh workflow run`) because a tag pushed with the default
`GITHUB_TOKEN` does not fire another workflow's `push: tags` trigger, and the
repository deliberately holds no long-lived token that would.

The tag step is hand-rolled rather than `changeset tag` behind the action's
`publish` input: gated on the action's `hasChangesets` output, it tags only
when the checked-out `package.json` version has no tag yet, so every other
push to main is a cheap, observable no-op and nothing depends on parsing
changeset stdout. `package.json` is the CLI version source; the installed
binary reads it directly, so changesets has no second CLI constant to update.
The authoring package version (`src/authoring/package.ts`) tracks the
walkthrough/prompt contract on its own policy and must never be wired in. What
would move this: npm dropping
per-workflow trusted-publisher pinning, or the repository adopting a bot
identity whose pushes may trigger workflows.

## CI installs ripgrep itself and forbids Pi's download fallback

Decided on [#82](https://github.com/basaltbytes/balade/issues/82). Pi resolves
`rg` by checking `PATH` and otherwise downloading it, resolving the version
through an unauthenticated `api.github.com` call — which shared runner IPs
rate-limit unpredictably, so ubuntu test jobs failed by lottery. `ci.yml` now
installs ripgrep from each OS package manager (apt/brew/choco) and runs
`pnpm test` with `PI_OFFLINE=1`, so search never reaches the fallback and a
missing binary fails deterministically with Pi's own unavailable error rather
than by network luck. The offline switch is safe because balade instantiates
only Pi's grep tool (`src/pi/session.ts`); nothing needs `fd`. What would move
this: Pi authenticating its tool downloads, or runner images shipping ripgrep.

## The Mechanism group explains the logic before the evidence

Walkthroughs exist so a human understands agent-written code without reading
every line of it. The skeleton now encodes that reading order: when a change
carries an algorithm or non-obvious logic, a Mechanism group sits directly
after Orientation and explains what the solution does and the logic behind it
— prose, `flow`, `diagram`; never pseudo-code, because the pinned code is one
click away and a second version of it teaches nothing. Each critical claim
pins its real range as a `{% code … collapsed=true /%}` block, so the evidence
sits under the claim and opens on demand. The explanation can drift; the
pinned range under it cannot — that adjacency, not reviewer trust in prose, is
what keeps the layer honest. The group replaced the trailing Deep dive slot
rather than joining it: two overlapping "slow path" homes would split the same
content, and pre-alpha removes rather than aliases.

The pattern is taught as a judgment call, not a structural rule: docs, config
and mechanical changes carry no algorithm, and the compiler enforces nothing —
unlike the closing full-PR diff, a missing Mechanism section is an authoring
quality issue, not invalid input. `collapsed` is an authored initial state
only; the app does not persist the reader's toggle. Evidence ranges count
against the unchanged 10-range budget on purpose — the cap is what forces
"critical pieces", not an inventory of hunks. Authored artifacts written
against the old skeleton (`.agents/walkthroughs/pr-88-*.md`,
`app/src/fixtures/pr96.ts`) keep their free-text `Deep dive` labels; group
labels are data, not contract. What would move this: dogfooding showing the
range budget starves evidence pinning, or reviewers wanting collapse state
persisted with the other review marks.

## PR package previews publish only after the tarball smoke test

The `npm-package` job publishes one pkg.pr.new preview after `package:smoke`
passes on a pull request. Keeping the step in that job avoids a second build and
ensures the uploaded package is the same package shape that installed and ran in
the smoke project. Pushes to `main` skip it; changesets and the OIDC npm release
workflow remain the only version, tag and registry path.

`pkg-pr-new` is a lockfile dependency, and CI invokes it with `pnpm exec` rather
than a downloader. The workflow token remains `contents: read` and carries no
npm credential; the installed pkg.pr.new App owns upload authentication, the
check and the pull-request comment. One concurrency group per pull request
cancels stale package jobs before an older commit can replace the current
preview comment.

`--pnpm` packs through the same package manager as `package:smoke`. Balade is a
binary, so `--bin` makes the comment show the direct `npx` command;
`--no-template` omits a browser template that cannot exercise this CLI. The
preview keeps the source package version instead of using `--previewVersion`:
the executable reports a build-time version synced by the release flow, while
the preview is selected by its pkg.pr.new URL and does not enter a dependency
range or project lockfile. What would move this: publishing a library API whose
preview must participate in dependency resolution.

## Mermaid draws the logic; the sink does not trust mermaid

Dogfooding the Mechanism pattern showed the model bending the grid `diagram`
block into sequential logic — sentence-long labels stacked one node per row —
because the format had no medium for flow pictures. Mermaid is that medium
now: a plain ```mermaid fence compiles to a `mermaid` block and renders
client-side. Authoring teaches it as encouraged-never-required, and the same
dogfooding pass bounded the evidence pattern: `collapsed=true` is legal only
on ranges directly under a substantial Mechanism explanation, a one-line claim
above a collapsed range is a rubric reject, and the grid diagram is reserved
for relation maps of changed parts — the one thing mermaid cannot draw, since
only the grid block carries per-part change status and section refs.

Rendering treats mermaid as an untrusted-input compiler, not a trusted
library. `securityLevel: "strict"` is insufficient on its own — html labels
default on even at strict, and `click … href` emits a real anchor — so the
config forces SVG text labels and extends mermaid's `secure` list with
`htmlLabels`/`themeCSS` (a diagram directive cannot re-enable them), and
`sanitizeDiagramSvg` guards the sink itself: anchors unwrapped, scripts
removed, every non-fragment URL attribute dropped. The guard lives at the
injection point rather than in the renderer so the test seam cannot bypass it;
the walkthrough-cannot-express-a-link invariant survives (conditions cited in
docs/threat-model.md). The renderer loads through the same lazy seam as the
diff highlighter, so SSR never imports mermaid and the served entry chunk
grows by ~3 kB. What would move this: mermaid gating links and html labels
behind `secure` upstream, or a CLI-side mermaid parse for `check` once one
runs without a DOM.

## The closing diff groups by authored partition, never by filter

A flat closing file list re-states what GitHub already shows; past a handful
of files it stops being a review surface. `{% files %}` therefore accepts
`{% filegroup label="…" only="…" status="…" /%}` children that split the same
browser into collapsible thematic sections. Grouping is authored, not
computed: thematic labels (Tests, Security, Models…) are a judgment about the
change, not something derivable from the tree, so the agent draws the groups
and balade only resolves them.

The semantics keep the #46 invariant by construction. Groups claim files in
authored order, first match wins, a filter-less group claims the remainder,
and files no group claims still render ungrouped after the groups — a grouped
closing block partitions the complete diff and structurally cannot hide a
file, so it still satisfies the compiler's closing rule. A group that claims
nothing warns (`filegroup-empty`) and is dropped from the payload;
`files-empty` keys on the grouped-plus-ungrouped total. The `files` schema is
no longer self-closing (Markdoc rejects children otherwise); both forms stay
valid, and a stray `filegroup` outside `files` vanishes silently like a stray
`step` — the existing child-family behavior.

In the app, groups start collapsed — the point of grouping a long browser is
opening one theme at a time — and the group head reuses the browser's own
stats sentence, so the feature adds no i18n string. Labels are PR-derived
free text: rendered only as React text children, keyed by position. The
authoring package teaches grouping as guidance, not a compiler rule: group
the closing block once the PR touches more than ten files. What would move
this: dogfooding showing globs cannot express the groups agents actually want
(an explicit path-list attribute), or reviewers wanting group collapse state
persisted with the review marks.

## Ordered steps are mermaid's job; the `flow` tag is gone

The format no longer has a `{% flow %}`/`{% step %}` block. The chip-arrow
strip it rendered kept appearing in generated walkthroughs as a low-signal
restatement of prose — a list wearing boxes — and it competed with the mermaid
fence, which draws the same sequence with real branching when a picture earns
its place. The tag is removed from the contract schema, the Markdoc config,
the compiler, the renderer, and the authoring catalog; the catalog now points
sequences and branching at a mermaid fence, and the grid `diagram` block keeps
its relation-map job. Removal is complete rather than deprecation because the
project is pre-alpha and untaught-but-renderable tags are exactly the
compatibility residue the charter says to delete. What would move this:
evidence that reviewers need an inline step strip that mermaid cannot supply.

## Generation announces both version lines before it resolves the pull request

Decided on [#102](https://github.com/basaltbytes/balade/issues/102). `generate`
prints `balade <cli> (authoring package <authoring>)` as its first stdout line.
The CLI version identifies the npm package that `npx` or a global install
resolved; the independently versioned authoring package identifies the prompt
contract that governs the draft. Printing both before pull-request resolution
makes a paid run attributable while it is still running.

The banner belongs only to `generate`. `check` stdout is an agent-facing
protocol, while the remaining commands finish quickly enough that a startup
identity would add noise. `package.json` is the single CLI-version source. The
CLI and generate command schema-decode that manifest at startup; Node's module
cache keeps it one file read without adding a shared pass-through module. A
missing or malformed manifest is a corrupted installation and stops startup as
a defect. The package smoke test executes the packed binary, covering npm's
always-included `package.json` and the relative lookups from `dist/`.

## Authoring prose lives in Markdown documents; typed data stays TypeScript

The three prose surfaces of the authoring package are Markdown files beside
their renderers, not template literals: the shared guidance
(`src/authoring/guidance.md`), the generated skill's own prose
(`src/authoring/skill.md`), and the Pi system prompt
(`src/pi/system-prompt.md`). Editing a prompt is editing a document — no
escaped backticks, real Markdown tooling, prose-only diffs. The typed data
(section templates, tag catalog, rubric, limits) stays TypeScript in
`src/authoring/`, because tests parse every example against the real Markdoc
config; it reaches the documents through `{{name}}` slots. Substitution
(`src/authoring/prose.ts`) is strict both ways — a placeholder without a
slot, a slot without a placeholder, and a malformed placeholder each throw —
so a rename fails the first rendering test instead of shipping a hole in a
prompt. Headings are the one transform: a document's `##` headings render
as-is in SKILL.md and as bare title lines in the plain-text Pi prompt
(`plainHeadings`, applied to the template before substitution so slot text
is never rewritten).

The CLI build stays plain tsc; `scripts/copy-prose.mjs` mirrors every
`src/**/*.md` into `dist/`, and `proseTemplate` resolves the document beside
the compiled module via `import.meta.url`, so sources under vitest and the
published package read the same bytes. `build:skill` and `package:smoke`
both run the installed CLI, so a missing copy fails the build. Reads happen
inside `sharedGuidance`, `skillMd()`, and the prompt builder, keeping import
time inert. The migration was verified byte-identical on every rendered
output (guidance in both heading modes, SKILL.md, the system prompt with and
without a preset), so the authoring package version did not move. Codegen
(`.md` compiled to a generated `.ts`) was rejected: the generated file either
lands in commits, duplicating every prose edit in the diff, or goes stale
between build steps. What would move this: a renderer that cannot read files
at runtime — a browser-bundled authoring surface — which would force the
codegen path.

## The hosted demo is a script knob, not an asset

balade.dev/demo serves a real static export: `build:demo` runs the freshly
built CLI's `balade build` on one committed walkthrough and writes
`site/public/demo/index.html`; `deploy:site` chains it before the site build,
so the demo is rebuilt by the same CLI it advertises and cannot go stale
against the renderer. The walkthrough path inside `build:demo` is the single
point of change — swapping the example is regenerate (or pick another
committed walkthrough), edit that one path, `pnpm deploy:site`. The export is
generated output, so `site/public/demo/` is ignored; the committed source of
truth stays the walkthrough file in `.agents/walkthroughs/`, like any other.
Committing the export was rejected: multi-megabyte generated HTML in history,
re-blessed by hand on every renderer change. What would move this: deploys
leaving the maintainer's machine (CI would need the demo built from a pinned
CLI), or more than one hosted example, which would turn the knob into a list.

## Fences render as read-only text; nesting still does not

A top-level fence in a section body becomes a `fence` payload block — the
mermaid shape plus the authored language id — and the app highlights it with
the existing shiki service. Unknown ids (pseudo-code, or nothing) resolve to
plain text; the pre-highlight state renders through React escaping, so the
untrusted source gains no markup channel and mermaid stays the only
third-party render path. The prompt encouraged pseudo-code for mechanism
explanations while the format dropped every non-mermaid fence with a warning;
the format now honors what the guidance teaches. Nested fences keep the
`fence-unsupported` warning: they sit inside markdown flow, where `MdNode` has
no slot for them. Rejected: a dedicated pseudo-code tag (a fence already says
it, and the block stays free under the range budget); rendering nested fences
(an `MdNode` variant and recursive rendering for marginal authoring value).
What would move this: authored walkthroughs hitting the nested warning often
enough that the flow representation needs the variant.

## Budgets guarantee termination; only the operator opts into economy

Inspection budgets come as three `--budget` tiers named for spend, not for
mechanism. `medium`, the default, scales with the pull request:
`inspectionBudget(changedFiles, tier)` allows two diff reads and two searches
per changed file and three source reads — slack for paging long diffs and for
the adjacent files a claim depends on — with floors (16/30/24) so small pull
requests explore freely. `high` removes enforcement (the prompt drops the
budget sentence). `low` allows one read of each kind per changed file — no
paging or adjacent-file slack — floored at the fixed caps balade shipped
before scaled budgets (8/20/12), for runs where spend is constrained but a
walkthrough is still wanted; choosing economy is the operator's explicit
call, never the tool's default. The earlier rationale
stands for the default: fixed caps actively shrank walkthroughs on
agent-scale input — the product's own target — to save money nobody asked to
save. The `x2` tier is gone: doubling an estimate few runs exhausted was a
knob without a question, and `high` already covers "don't stop me". What
would move this: spend complaints against `medium`, which would argue for
tuning its scale factors, never for capping the default.

## Color is a theme the formatter opts into; the write edge admits only its palette

Terminal color rides `node:util.styleText`, no dependency: a `Theme` of six
semantic slots (`error`, `warning`, `ok`, `emphasis`, `muted`, `url`) built
per stream, so piped output, `NO_COLOR` and `FORCE_COLOR` resolve without a
flag of our own. `plainTheme` is the formatter default — `formatText` also
serves the model repair prompt and tests, which must stay byte-plain — and
each command passes `stdoutTheme`/`stderrTheme` explicitly at its boundary.
The terminal-injection invariant moved from "the writers strip everything" to
two layers: untrusted values are control-stripped where they are interpolated,
and the writers keep only the theme's own single-parameter SGR sequences
(no conceal, no cursor control, no OSC), so a missed interpolation site can at
worst borrow a palette color.
A live progress display for `generate` (activity spinner, phase lines,
elapsed clock) was built on top of these colors and backed out: the author's
event stream has no state semantics — tools are millisecond reads while the
minutes are eventless generation gaps — and the synchronous `CommandExecutor`
blocks the event loop through the whole check phase, so every animated
display ended up lying. Issue #122 carries the post-mortem and the shape of a
real fix (owned status model, async process port, faux-provider TTY harness).
What would move this: a renderer needing richer styling than six slots, which
would argue for widening the palette allowlist in the same motion as the
theme, never for trusting formatter output wholesale.

## Anti-slop lint rules are vendored, not depended on

The fifteen `anti-slop/*` rules — [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop)
— live at `tools/oxlint/anti-slop/` and register through `jsPlugins` in
`.oxlintrc.json`, every rule at `error`. Vendoring is upstream's own contract:
the copy is team-owned, so weakening or deleting a rule is an edit here, never
a version negotiation. `oxlint` and `@oxlint/plugins` move in lockstep (1.78.0)
because the JS-plugin API is alpha and outside semver. The plugin sits outside
all three tsconfig projects; its consumer is oxlint's loader, which
type-strips it on Node ≥ 22.18 and exercises it on every lint run, and
`oxlint .` holds the vendored source to its own rules. `no-module-mocking`
turns the "tests go through real seams" rule from prose into a diagnostic.
What would move this: an upstream rule worth re-importing, which is a manual
diff against the vendored copy — or the plugin API stabilizing, which would
relax the version lockstep, never the vendoring.

## Anti-slop compliance has four idioms, not one

Clearing the vendored rules settled how this codebase writes four shapes.
Optional properties build through a named facet draft — a local
`type XFacets = { … }` alias, filled in statements, spread once into the
readonly contract literal — never through `...(x ? { x } : {})`; where key
order feeds a serializer (the YAML frontmatter, the prompt claims JSON) the
facet spreads at the position the conditional held. Lookup tables keyed by an
arbitrary string are `Map`s; tables with a closed key union stay object
literals under `satisfies`, which keeps typed indexing. Runtime narrowing goes
through `effect`'s `Predicate` guards or the owning library's named types
(Markdoc `Scalar`, the SDK's event fields) instead of `typeof`; `unknown`
survives only as a `cause`. Each remaining `as` states its invariant in a
`SAFETY:` comment placed before the assertion's statement. One boundary moved
in the sweep: the review-state PUT body crosses the `Api` port as text and
`writeState` runs the whole JSON-plus-schema parse itself, so the gate owns
its parse instead of splitting it with the transport. What would move this: a
facet type outgrowing its file, which would argue for a shared helper —
weakening a rule to avoid the idiom is not on the table.

## Agent presence is balade's own lifecycle; multiplexers are adapters

Terminal agent multiplexers (herdr, cmux) show which pane is working, blocked,
or done. None of their detection paths can see balade: process detection knows
only the agent binaries bundled into the multiplexer, Pi lifecycle
integrations load as Pi extensions — balade's authoring session deliberately
loads none, they gate on Pi's TUI run mode, and they would report `pi` as the
identity — and screen manifests match interactive UI balade does not draw. The
lifecycle worth reporting is also not the Pi session's: model choice, login,
snapshot preparation, check/repair and serving all happen outside it.

So the lifecycle is balade's own — `working`, `waiting`, `settled` — behind
the `AgentPresence` port (`src/presence.ts`), one adapter per multiplexer
dialect, provided once in `cliLayer`. `generate` reports the transitions;
other verbs can join later. The port is a direct service method, not a
PubSub: sinks are few and known at wiring time, and the one delivery
guarantee that matters — the final `settled` surviving process teardown —
is exactly what a broker's drain-on-interrupt semantics fight.

The herdr adapter self-reports over herdr's socket API (`pane.report_agent`,
`source: custom:balade`), herdr's documented path for agents its binary does
not know. It activates only when herdr's pane environment
(`HERDR_ENV`/`HERDR_SOCKET_PATH`/`HERDR_PANE_ID`) is present; any other pane
gets the no-op layer, so presence costs nothing outside a multiplexer.
Reports coalesce through a sliding(1) queue drained by a scoped fiber —
states are latest-wins, not a log — and the first report arms a scope
finalizer that flushes `settled`: a duplicate idle report is harmless, a pane
stuck `working` is not. A command that never reports presence sends nothing,
so `check`, `open`, and the other verbs do not register a balade agent merely
because the shared CLI layer was built. Frames carry fixed lifecycle literals,
herdr's own pane id, and a local sequence — never PR-derived text — so the
authoring containment does not move. `waiting` maps to herdr's `blocked`,
`settled` to `idle`; herdr derives "done" itself when an unseen pane goes idle.

Future sinks ride the same port: OSC title/progress sequences (the signal
observation-based tools share), a cmux `set-status` adapter, or an
operator-configured hook command that would let multiplexers integrate
balade without balade naming them.

## Generation repair turns require diagnostic progress

After each repair, the pipeline compares the diagnostic-location multiset
(`code`, `line`) with the report that prompted it. An unchanged set stops the
loop after that turn; a changed set may use the remaining attempt, up to the
existing hard cap of two. Messages, hints and range echoes do not count as
progress because the checker can reword or re-echo the same defect without the
draft becoming closer to valid. Rejected: always spending the full retry budget
(it pays again for a proven dead end), and comparing the rendered file (a model
can rewrite prose without repairing validation).

The complete report stays in the repair prompt. Filtering diagnostic codes in
the generation command was rejected after
[#116](https://github.com/basaltbytes/balade/issues/116) moved the prepared pull
range into the checker: the known false staleness and empty-diff diagnostics
now disappear at their source, while a command-local denylist would duplicate
checker semantics and drift as diagnostics change. What would move this:
diagnostics gaining an explicit repair owner or structured fix target in the
shared contract.

## Clarifications are generation-bound sidecars, not walkthrough content

Reviewer Q&A for issue #131 lives in one
`.balade/<walkthrough>.qa.json` sidecar beside review marks. The sidecar carries
the walkthrough path, PR number and stamp; a mismatch makes the whole value
absent. Questions stay anchored to the selected section id and quoted passage,
so no locator needs to drift across edits. Pending, answered and failed are
explicit states. A provider failure persists only the question and a generic
failure marker, never credentials or provider diagnostics, and a later
follow-up can retry the conversation.

Every question and follow-up creates a fresh scoped Pi session. Generation and
clarification share one pinned, read-only inspection-tool module and one
sandbox session assembler, while each workflow owns its submit tool and prompt.
The clarification prompt receives the walkthrough source, pinned diff, anchor
and completed turns as untrusted data.
Its submitted Markdoc fragment is parsed with the canonical walkthrough grammar
and compiled into `Block` values before the sidecar changes to answered. This
keeps Q&A out of the committed document and adds no renderer-only dialect or
HTML sink. The server writes pending state before forking the run, serializes
all transitions with one semaphore, and writes the sidecar by same-directory
temporary-file rename so polling never observes partial JSON. Committing the
pending state and starting its supervised worker are one uninterruptible
handoff. The worker starts synchronously enough to install its exit finalizer
before the handoff returns, so a closing server settles an in-flight question
as failed instead of leaving a permanent pending record.

Static exports deliberately omit Q&A: asking requires the local repository,
the selected model under `~/.balade/pi/`, and the live loopback server. What
would move this is an explicit portable-conversation feature with its own
privacy and credential model, not an implicit extension of export payloads.
