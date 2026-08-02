# Decisions

Trade-offs this package has already weighed. Each entry states what holds today
and what would move it.

## The payload contract stays plain interfaces

`src/payload/types.ts` crosses into the SPA, which imports it as types only. A
schema library there would either follow it across the boundary or force a
second declaration of the same shape. Economy of change: the contract stays
plain, and the edges that read it parse before they trust —
`app/src/data/source.ts` for the payload, and `src/payload/parse-review.ts` for
review state.

That last one is the exception to "app imports the CLI as types only": the
server and the SPA guard the same JSON, so the pure function lives beside the
contract and both sides import it. What stays forbidden is CLI *runtime* — git,
fs, process — reaching `app/`.

## The core returns records; Effect stays at the CLI edge

Every core function answers `{ value, diagnostics }` (or `{ payload, … }`) and
throws nothing a caller must catch. Effect appears only in `src/cli.ts`, where
it owns argument parsing and process exit. One dialect per layer; a full Effect
migration would buy retries and typed error channels the core has no use for.

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
service (`src/pr/locate.ts`) with typed errors — the first piece of the
Effect-throughout direction; the sync core it calls into is unchanged.

## Resolution shells out through `spawnSync`

One resolve costs 2576 ms across 25 processes — fine for `check`, too slow to
repeat per request. The decided path is the synchronous adapter plus a
served-mode payload cache keyed `(sourcePath, pin, head)`, which turns repeat
requests into a map lookup. If the cache falls short, `execAsync` goes in beside
`exec` in `src/resolve/exec.ts`, behind the same seam.

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

## No property tests yet

The parsers — `parseFrontmatter`, `parseReviewState`, `parsePayload`, `splitDiff`,
`parsePo` — are what properties would pay for: roundtrips, idempotence, "junk in
never yields a half-built value". `fast-check` is not a dependency, so the suite
is example-based. The gap is named, not hidden.

## The renderer has no DOM-level test

`app/src/data/` is covered at parse level, and `render.test.tsx` renders the whole
fixture to a string. Nothing exercises a click, a `useEffect`, or the store from
inside a component: that needs `jsdom`, which is not a dependency. The stores take
their storage and fetch as parameters, so the seam is ready when it is.
