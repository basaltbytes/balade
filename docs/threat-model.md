# Threat model

balade renders a pull request into a review app. This document states who might
attack that, through which surfaces, and what they would get — so the next
change to a trust boundary is made deliberately.

It records positions and invariants. The reasoning behind individual design
choices lives in [DECISIONS.md](../DECISIONS.md); this document points at those
entries rather than restating them.

## The premise: review happens before trust

A reviewer runs balade on a diff *precisely because no human has judged it yet*.
Everything derived from the pull request — its title, body, linked issues,
commit messages, branch names, file paths, and file contents — reaches the
authoring agent and the reviewer's browser **ahead of that judgment**.

So the whole model rests on one rule:

> **Every string derived from a pull request is untrusted, author-controlled
> input.** That includes the repository's own files at the PR head.

The authoring prompt already says this outright for PR metadata
(`src/pi/authoring.ts:40`). This document extends it to every other surface.

Two properties follow, and they are the ones worth defending:

1. **A review tool must not be ownable by the thing it reviews.** Nothing in a
   diff may execute on the reviewer's machine or in their browser.
2. **The walkthrough must describe the diff honestly.** balade's value is that a
   reviewer can understand a change through its walkthrough. An attacker who
   steers the narrative — hiding a file, describing a backdoor as a refactor —
   defeats the tool at its purpose without breaking a single technical control.

The second is the harder one, and it is specific to an agent-authored tool.
Classic threat models stop at code execution; here, *content control is the
attack*.

## Actors

| Actor | Capability |
|---|---|
| **Fork contributor** | Full control of the PR head tree, PR title and body, branch names, commit messages. Anyone at all, on a public repository. |
| **Poisoned authoring agent** | An agent authoring a PR that picked up an injection payload from the code or issues it read. Produces a PR whose text steers the *next* agent. Not hypothetical — this is the normal failure mode of agent-authored PRs. |
| **Malicious web page** | Any other tab open in the reviewer's browser while the review server runs. Reaches `127.0.0.1` by DNS rebinding. |
| **Export recipient** | Anyone the reviewer shares a built HTML file with, plus anything else running on their machine that can read `file://` storage. |
| **Compromised dependency or action** | A package or GitHub Action in the supply chain. |

## Assets

- The reviewer's **machine** — files, credentials, ability to execute.
- The reviewer's **judgment** — the walkthrough's accuracy. Corrupting it is the
  highest-value attack and leaves no technical trace.
- **Repository contents** — source at both revisions, history, private repos the
  reviewer's token can reach.
- **Provider credentials** — the Pi authoring session's auth.

## Entry points

### 1. PR text → the authoring prompt

`balade generate` puts PR title, body, linked-issue text and commit subjects
into the prompt. These are explicitly framed as untrusted claims, never
instructions (`src/pi/authoring.ts:40`, `:129`).

Repository instruction files (`AGENTS.md` / `CLAUDE.md`) come from the pinned
PR head. An instruction file changed by the PR is omitted and reported unless
the reviewer passes `--trust-head-instructions` after inspecting it. Files that
contain a project-context closing tag are rejected regardless of that flag
(`src/pi/authoring.ts`, `src/pi/project-context.ts`; see
[#61](https://github.com/basaltbytes/balade/issues/61)).

Linked issues are fetched with the reviewer's own GitHub token. Same-repository
issues stay under author-stated intent; cross-repository issues remain available
under a separate third-party claims heading, with a notice naming the foreign
repository ([#59](https://github.com/basaltbytes/balade/issues/59)).

### 2. PR bytes → the renderer

`balade open <pr-url>` compiles a walkthrough read straight from the untrusted
PR head, and displays file bytes from it
(`src/commands/open/locator.ts:102-122`, `src/server/repo.ts:106-109`).

Nothing from the PR head executes on the machine: the head is never checked out,
so no hook, filter or `.gitattributes` rule applies; `git show` emits raw blobs;
Markdoc registers no variables, functions or partials
(`src/walkthrough/config.ts:11-16`); and compilation is a pure transform into a
JSON payload of plain data. The exposure is the browser origin.

When the walkthrough comes from a fetched PR head, the CLI names the PR and
head commit and labels the content unreviewed before serving it. A walkthrough
read from the working tree carries no such notice.

### 3. The local review server

Binds `127.0.0.1` with no host flag (`src/server/http.ts`). Five routes; one
mutating endpoint, `PUT /api/state`.

A global middleware accepts only the loopback authorities `127.0.0.1`,
`localhost` and `[::1]`, ignoring a numeric port. This rejects DNS-rebinding
requests before route handling because their `Host` header still names the
attacker's origin. The state endpoint limits its JSON body to 4 MiB, and
responses admitted by the host guard carry `X-Frame-Options: DENY` so another
site cannot frame the review UI. Typed API failures retain their internal cause
for server-side diagnostics, while `500` responses expose only stable messages
and never filesystem or exception details
([#63](https://github.com/basaltbytes/balade/issues/63)).

### 4. The export bundle

`balade build` inlines the app and payload into one HTML file, meant to be
opened over `file://` ([DECISIONS.md](../DECISIONS.md), "The export bundle
carries every grammar"). It embeds the **full contents of every changed file at
both revisions**. The CLI reports the number of embedded files after writing the
export, and the README names the remaining source and metadata it carries. Its
meta CSP forbids programmatic network connections; a shared file still
discloses all of its embedded data to its recipient.

### 5. Supply chain and CI

Dependencies are pinned exact; publishing uses OIDC trusted publishing with no
long-lived token ([docs/releasing.md](releasing.md)). Actions are pinned to
full commit SHAs with Dependabot (`.github/dependabot.yml`) bumping the pins;
`ci.yml` holds a read-only token
([#57](https://github.com/basaltbytes/balade/issues/57)).

## Verified invariants

These were checked against source during the audit of
[#50](https://github.com/basaltbytes/balade/issues/50). They are the baseline a
change must not silently break — cite them, and re-verify if you touch the code
they describe.

**Payload decoding**

- Both payload entry points decode with `onExcessProperty: "error"`
  (`app/src/data/source.ts:29-32`, baked `:124`, served `:112`);
  `window.__BALADE__` is typed `unknown`. Enforced, not conventional.
- The schema is **shape-only** — no length, bound or protocol refinements.
  Expensive consumers enforce their own limits, as recorded below and in
  [#74](https://github.com/basaltbytes/balade/issues/74).

**Rendering**

- The `Inline` contract has **no link and no HTML kind** — the union is
  `string | array | {c} | {b} | {i} | {m} | {tag}`
  (`src/contract/schema.ts:19-47`). The compiler drops link and image shells and
  keeps only their text (`src/walkthrough/inline.ts:41`). A walkthrough
  structurally cannot express a link. This is the strongest control in the app.
- `Rich` (`app/src/ui/rich.tsx`) renders every branch as a React text child. No
  `href`, no `style` from data, no HTML sink.
- Exactly one `dangerouslySetInnerHTML` **in balade's own source**
  (`app/src/widgets/code.tsx:138`), fed by shiki over payload text; grammars are
  a closed 31-entry allowlist falling back to `"text"`
  (`app/src/highlight/shiki.ts:86-90`). `@git-diff-view/react` adds four more on
  the same attacker-controlled bytes — see below.
- **shiki's `codeToHtml` output is safe to inject.** Text nodes are escaped by
  `hast-util-to-html` via `stringifyEntities`, attribute values by
  `handle/element.js`, and raw HTML is off by default (`allowDangerousHtml:
  false`), with shiki calling `toHtml` with no options
  (`@shikijs/core@4.4.1/dist/index.mjs:1024`, `:1035`). Nothing balade passes
  can change that: only `lang`, `theme` and `transformers`
  (`app/src/highlight/shiki.ts:171-186`), and its single transformer only adds
  static class names. `style` values come from the bundled theme, never from
  input.
- No syntax grammar receives a line longer than 2,000 characters. Code excerpts
  use React's escaped plaintext rendering and show a localized note; diff views
  use Shiki's plaintext grammar. Diff highlighting remains off until the custom
  highlighter loads, and plaintext counts as registered, so the bundled
  highlight.js `highlightAuto` fallback never receives PR bytes
  (`app/src/highlight/shiki.ts`, `app/src/highlight/diff-highlighter.ts`).
- Shiki initialization, grammar loading and HTML rendering cross typed Effect
  errors before the app logs and chooses plaintext. The synchronous diff
  adapter uses typed `Result` values for registry inspection and HAST rendering;
  on failure it stays on the custom adapter and returns a root containing only
  the raw text node, so no lowlight fallback or content-derived property is
  introduced (`app/src/highlight/shiki.ts:96-229`,
  `app/src/highlight/diff-highlighter.ts:24-80`).
- Diagram coordinates are clamped to 1–64 by both the CLI transform and the
  renderer (`src/contract/diagram.ts`, `app/src/widgets/diagram.tsx`). No
  diagram can make the renderer materialize more than 4,096 grid cells.
- The only payload-derived `href` is `pr.url` (`app/src/ui/chrome.tsx:36`),
  which is GitHub-derived (`src/git/git.ts:229`) and additionally protected by
  React 19's `javascript:` blocking.
- `@git-diff-view/react@0.1.7` escapes all content it renders. Its four
  `dangerouslySetInnerHTML` sinks are fed by templates that route every
  content interpolation through `escapeHtml`. **Three conditions hold that
  safety** and must not be broken:
  1. No highlighter or transformer may emit content-derived `hast` properties —
     `class` and `style` are interpolated **unescaped**
     (`@git-diff-view/core/src/parse/template.ts:164-166`, `:184-188`,
     `:243-245`, `:340-342`). Safe today only because those values come from
     theme data.
  2. `setTransformForTemplateContent` (`core/src/parse/transform.ts:24`)
     replaces the escape function globally. It must stay uncalled.
  3. The `renderWidgetLine` / `renderExtendLine` / `extendData` props render
     arbitrary nodes next to attacker rows. They must stay unpassed.

**Process and filesystem**

- The local server rejects a missing or non-loopback `Host` before any static or
  API handler runs. The allowlist is exact and port-insensitive; it contains
  `127.0.0.1`, `localhost` and `[::1]` (`src/server/http.ts`).
- `PUT /api/state` provides Effect's `MaxBodySize` at 4 MiB around the JSON read.
  Oversized bodies become the existing `ApiReviewStateInvalid` response instead
  of growing the Node string without a bound.
- Responses admitted by the host guard carry `X-Frame-Options: DENY`. The served
  UI cannot be framed even though `frame-ancestors` cannot be enforced from its
  meta CSP.
- API errors retain their typed causes until the HTTP boundary. Internal `500`
  failures log their complete Effect cause chain there after terminal-control
  sanitization, but their JSON responses contain no exception text or absolute
  filesystem paths.
- **No shell strings anywhere.** Every git, gh and browser invocation goes
  through `spawnSync(file, [...args])` with no `shell: true`
  (`src/shell.ts:41-46`, `src/server/browser.ts:73`). Terminal output is
  control-stripped at the edge (`src/terminal.ts:13-28`).
- Attacker-controlled paths reaching git are `--`-guarded with `:(literal)`
  pathspec magic (`src/git/git.ts:135-145`, `src/pi/session.ts:195-206`,
  `src/server/repo.ts:158`). SHA-prefixed composites cannot begin with `-`: the
  SHA is gated by `/^[0-9a-f]{40,64}$/u` (`src/git/pr.ts:117`). Frontmatter
  `commit` is validated hex (`src/contract/schema.ts:441`).
- PR-controlled revision names follow `--end-of-options` in
  `git rev-parse --verify --quiet`, so a leading dash remains revision data and
  cannot abort resolution (`src/git/git.ts`).
- Frontmatter key line lookup uses literal string operations. An unknown key
  cannot become regular-expression source or escape the diagnostic channel
  (`src/walkthrough/frontmatter.ts`).
- `?path=` never reaches the filesystem: it is allowlist membership against the
  served set (`src/server/api.ts:124-137`). State filenames keep only the
  basename (`src/state.ts:64-68`). Two independent barriers; **no arbitrary file
  write exists.**
- The `.balade/` line appended to the clone's `info/exclude` is a module
  constant (`src/state.ts:40`) — **no injection into that file is possible.**
  Its destination directory is `git rev-parse --git-common-dir` output for the
  local clone (`src/shell.ts`), local git metadata a PR head cannot influence.
- Static serving is not traversable: decode → null-reject → normalize →
  prefix-confine (`effect` `HttpStaticServer`), and it registers `GET` only.
  That path does **not** resolve symlinks, so a symlink inside the served root
  would be followed — but the root cannot contain one: it is the hardcoded
  `APP_DIR` beside the CLI with no flag to override it
  (`src/server/http.ts:34`, `:58-67`); `dist/app` is rollup output with
  `emptyOutDir: true` and no `publicDir` copy step (`app/vite.config.ts:24`);
  no CLI path writes into it; and both `npm pack` and `pnpm pack` were tested to
  strip symlinks from the tarball. **Re-check this if `app/public/` is ever
  added.**

**Authoring sandbox**

- A seven-tool allowlist, all read-only (`src/pi/session.ts:333-350`). No shell,
  no write, no network. The agent cannot execute anything.
- Pinned and base source reads share one repo-relative path gate. It rejects
  credential basenames case-insensitively (`.env*`, auth files, private-key
  formats and credential/secret names) plus `.aws/`, `.ssh/` and `.gnupg/`
  directory segments. The authoring prompt separately forbids reproducing
  credential values and requires an explicit omission note.
- PR and linked-issue URLs from `gh` must parse to repository locations before
  provenance is classified. A malformed location drops the optional GitHub
  enrichment with a notice instead of becoming a guessed third-party label.
- PR-head `AGENTS.md` and `CLAUDE.md` files enter the system prompt only when
  unchanged by the PR or explicitly trusted with `--trust-head-instructions`.
  Project-context closing tags are rejected before interpolation.
- The snapshot is `git archive <pin>` with lexical, symlink and realpath
  containment (`src/pi/snapshot.ts:135-172`, tested in
  `test/snapshot.test.ts:34-71`).
- `search_source` regexes go to ripgrep (Rust regex — linear time, no
  catastrophic backtracking), bounded to 20 searches / 200 matches / 80k chars.
- The process installs the balade-owned `RIPGREP_CONFIG_PATH` once before Pi can
  dispatch searches in parallel. No search restores process-global state, so
  every ripgrep spawn retains `--no-ignore` and `--no-follow`.
- Pi credential isolation holds: balade uses its own agent directory
  `~/.balade/pi/` and never reads or writes `~/.pi/agent/`
  (`src/pi/client.ts:81-105`, `test/pi-agent-dir.test.ts`, issue #27).

**Export**

- The `</script>` and `<!--` escaping in `src/commands/build/html.ts:39-62` is
  sound and **load-bearing** — today's bundle contains eleven `<!--` and four
  `<script>` sequences. See the DECISIONS entry "The inlined bundle is escaped,
  the baked payload is JSON-escaped" and `test/build.test.ts:186`.
- `payload.lang` interpolated into `<html lang>` is constrained to `"en" | "fr"`
  (`src/contract/schema.ts:339`).
- The export's meta CSP admits its inline script and style but sets
  `connect-src 'none'`; the served page has a separate policy admitting scripts,
  styles and API calls only from its own origin. Neither policy admits frames,
  forms or a base URL.

**CI**

- No PR-controlled `${{ }}` interpolation, and no `pull_request_target`.
  `release.yml` and `changesets.yml` scope `permissions:` tightly; `ci.yml` does
  not ([#57](https://github.com/basaltbytes/balade/issues/57)).

## What balade does not defend against

Stating these keeps the model honest.

- **A malicious reviewer's own machine.** balade runs with the reviewer's
  credentials and repository access by design.
- **A compromised dependency at install time.** Exact pinning and a lockfile
  make a swap visible in a diff; they do not stop a malicious version the
  reviewer installs.
- **The provider seeing PR content.** `balade generate` sends diff and source to
  the model provider. That is the feature.
- **Anything after an export leaves the machine.** A shared HTML file is a
  shared file. See [#67](https://github.com/basaltbytes/balade/issues/67).

## Recurring gate

A one-shot audit ages badly, and agent-authored mega-diffs are the norm in this
repository — the exact condition under which a boundary erodes without anyone
noticing.

**Position, for pre-alpha: no automated recurring review.** A full agent-driven
pass over a branch is expensive, and during pre-alpha the API churns faster than
the findings would stay true. Revisit once the surface settles.

What runs instead, and costs nothing:

- **The verified invariants above are the checklist.** Most are a single grep.
  Reading them before touching a boundary is the whole gate.
- **A PR that touches a trust boundary says so.** The boundaries are the payload
  schema, the render sinks, the authoring tool allowlist, the server routes, the
  export HTML, and the workflow files. A PR that moves one names the invariant
  it affects; every other PR says nothing and pays nothing.

**Revisit at the first stable release.** At that point a branch-scoped
`/security-review` before each release is the natural cadence — releases are
already a deliberate, changesets-driven checkpoint
([docs/releasing.md](releasing.md)), so it attaches to something that already
happens rather than inventing a ritual.
