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
(`src/pi/authoring.ts:127-129`). This document extends it to every other surface.

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
- **Provider credentials** — the auth shared by Balade's generation and live
  clarification workflows.

## Entry points

### 1. PR text → the authoring prompt

`balade generate` puts PR title, body, linked-issue text and commit subjects
into the prompt. These are explicitly framed as untrusted claims, never
instructions (`src/pi/authoring.ts:127-129`).

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

`generate --prompt` adds the one trusted string in this prompt: reviewer
guidance typed by the operator on their own command line, in a labeled block
distinct from the claims. The invariant is that it stays argv-only — a variant
that read guidance from a file at the PR head would reopen the boundary
`--trust-head-instructions` guards
([#103](https://github.com/basaltbytes/balade/issues/103)).

### 2. PR bytes → the renderer

`balade open <pr-url>` compiles a walkthrough read straight from the untrusted
PR head, and displays file bytes from it
(`src/commands/open/locator.ts:102-125`, `src/server/repo.ts:112-116`).

Nothing from the PR head executes on the machine: the head is never checked out,
so no hook, filter or `.gitattributes` rule applies; `git show` emits raw blobs;
Markdoc registers no variables, functions or partials
(`src/walkthrough/config.ts:11-16`); and compilation is a pure transform into a
JSON payload of plain data. The exposure is the browser origin.

A ```mermaid fence widens that origin exposure: its source reaches the browser
verbatim and a third-party library turns it into markup the app injects. The
conditions that bound it are recorded under "Rendering" below.

Any other top-level fence reaches the browser the same way, as a `fence`
block, but opens no third-party markup path: shiki emits escaped tokens from
the source, and the pre-highlight fallback renders the raw text through
React's own escaping. The mermaid conditions below do not apply to it.

When the walkthrough comes from a fetched PR head, the CLI names the PR and
head commit and labels the content unreviewed before serving it. A walkthrough
read from the working tree carries no such notice.

### 3. Reviewer questions → the clarification agent

Selected passages, questions, prior exchanges and the walkthrough itself are
untrusted prompt data. Each question runs in a fresh Pi session with the same
pinned, read-only repository inspection tools as generation. Changed
`AGENTS.md` and `CLAUDE.md` files are always omitted from clarification runs;
no session extension, shell, write, or network tool is available.

Opening a walkthrough does not load Pi or require provider authentication.
Opening a Q&A panel calls `GET /api/agent`, which exposes only whether setup is
required, not provider, model or credential details. A first `POST /api/qa` may
start the shared provider/model setup interaction in the trusted terminal that
launched `balade open`; the question is enqueued only after setup succeeds. The
endpoint still requires an `application/json` body and emits no CORS
permission, so a cross-origin form cannot initiate that credential flow. The
request includes the PR number and stamp displayed by the browser. The server
checks that generation before and after setup and again after preparing agent
context, rejecting stale pages before they can persist a question.

The agent submits a Markdoc fragment, not browser markup. The fragment is
parsed with the walkthrough grammar, cannot create sections, groups or file
browsers, resolves code references at the stamped commit, and compiles to the
existing `Block` contract before persistence. The renderer therefore gains no
new HTML sink.
Questions and answers live only in a git-excluded Q&A sidecar bound to the
walkthrough path, PR number and stamp. Static exports contain none of it.

### 4. The local review server

Binds `127.0.0.1` with no host flag (`src/server/http.ts`). Seven API routes;
two mutating endpoints, `PUT /api/state` and `POST /api/qa`.

A global middleware accepts only the loopback authorities `127.0.0.1`,
`localhost` and `[::1]`, ignoring a numeric port. This rejects DNS-rebinding
requests before route handling because their `Host` header still names the
attacker's origin. The state endpoint limits its JSON body to 4 MiB and the Q&A
endpoint limits its request body to 64 KiB. Both bodies pass strict schema decoding,
and responses admitted by the host guard carry `X-Frame-Options: DENY` so another
site cannot frame the review UI. Typed API failures retain their internal cause
for server-side diagnostics, while `500` responses expose only stable messages
and never filesystem or exception details
([#63](https://github.com/basaltbytes/balade/issues/63)).

### 5. The export bundle

`balade build` inlines the app and payload into one HTML file, meant to be
opened over `file://` ([DECISIONS.md](../DECISIONS.md), "The export bundle
carries every grammar"). It embeds the **full contents of every changed file at
both revisions**. The CLI reports the number of embedded files after writing the
export, and the README names the remaining source and metadata it carries. Its
meta CSP forbids programmatic network connections; a shared file still
discloses all of its embedded data to its recipient.

### 6. Supply chain and CI

Dependencies are pinned exact; publishing uses OIDC trusted publishing with no
long-lived token ([docs/releasing.md](releasing.md)). Actions are pinned to full
commit SHAs with Dependabot (`.github/dependabot.yml`) bumping the pins;
`ci.yml` holds a read-only token
([#57](https://github.com/basaltbytes/balade/issues/57)). Pull-request previews
run `pkg-pr-new` from the lockfile only after the npm-package smoke test. The
pkg.pr.new GitHub App authenticates the upload and PR comment; the workflow
receives no npm credential and retains the same read-only token.

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
- Three `dangerouslySetInnerHTML` sinks **in balade's own source**. The code and
  generic-fence sinks (`app/src/widgets/code.tsx:142`,
  `app/src/widgets/fence.tsx:23`) are fed by shiki over payload text; grammars
  are a closed 31-entry allowlist falling back to `"text"`
  (`app/src/highlight/shiki.ts:32-94`). The mermaid sink
  (`app/src/widgets/mermaid.tsx:28`) is fed by mermaid — see below.
  `@git-diff-view/react` adds four more on the same attacker-controlled bytes.
- **shiki's `codeToHtml` output is safe to inject.** Text nodes are escaped by
  `hast-util-to-html` via `stringifyEntities`, attribute values by
  `handle/element.js`, and raw HTML is off by default (`allowDangerousHtml:
  false`), with shiki calling `toHtml` with no options
  (`@shikijs/core@4.4.1/dist/index.mjs:1024`, `:1035`). Nothing balade passes
  can change that: only `lang`, `theme` and `transformers`
  (`app/src/highlight/shiki.ts:186-200`), and its single transformer only adds
  static class names. `style` values come from the bundled theme, never from
  input.
- **mermaid's SVG output is injected, and `securityLevel: "strict"` alone does
  not make that safe.** Verified against `mermaid@11.16.1`; line numbers name
  `dist/mermaid.js`, the readable build of the ESM entry the app imports. Under
  `strict` mermaid sanitizes the whole SVG string it returns with its bundled
  `dompurify@3.4.0` (`:6896`), adding only `foreignobject` and
  `dominant-baseline` to the default profile (`:191371-191372`, `:191651`); it
  sanitizes every label text the same way (`:22395-22420`); it refuses
  `click … call` callbacks, which register at `loose` only (`:47676-47678`,
  `:144525`, `:157266`); and it sends a `click … href` URL through
  `@braintree/sanitize-url` (`:34481-34489`). **Four conditions hold this sink
  safe** and must not be broken:
  1. HTML labels are off. They default to **on** even at `strict` —
     `config.htmlLabels ?? config.flowchart?.htmlLabels ?? true` (`:6887-6892`)
     over a shipped default that sets neither (`:5815`) — so `MERMAID_CONFIG`
     (`app/src/mermaid/mermaid.ts`) sets the root switch plus
     `flowchart.htmlLabels` and `class.htmlLabels`, because some shape renderers
     read the flowchart one directly (`:45302`, `:48318`). Labels stay SVG text.
  2. The diagram source may not reconfigure mermaid. A `%%{init}%%` directive or
     a YAML `config:` block inside the source reaches `addDirective`
     (`:191373-191378`), which drops only the keys named in `siteConfig.secure`
     (`:6818`). mermaid's own list holds six, and not `htmlLabels`
     (`:6344-6351`), so `MERMAID_CONFIG` extends it with `htmlLabels` and
     `themeCSS`. `secure` is always first in that list, so a directive cannot
     shorten it; `maxTextSize` (50,000 characters) and `maxEdges` (500) are on
     it already, so a diagram cannot raise its own bounds (`:6336-6337`).
  3. `bindFunctions` is never called. The renderer keeps only `svg` off the
     render result, so nothing a diagram declares becomes a listener;
     `attachFunctions` replays only what `setClickFun` registered, which stays
     empty outside `loose` (`:191245-191251`).
  4. Everything the renderer returns passes `sanitizeDiagramSvg` before it is
     injected. **A link does survive strict mode**: `setLink` carries no
     security gate (`:47722-47731`) and the node renderer wraps the shape in
     `<svg:a xlink:href=…>` (`:50015-50022`, `:171899-171909`), which DOMPurify
     keeps. The guard parses the markup into an inert `DOMParser` document,
     unwraps every `<a>`, removes `<script>`, and drops every `on*` attribute
     and every `href`/`xlink:href`/`src`/`target`/`ping`/`formaction` that is
     not a `#` same-document reference — mermaid's own marker and icon
     references are all that stay. The rule that a walkthrough cannot express a
     link therefore holds at this sink too, and no PR-derived URL is fetched.
     `app/src/mermaid/mermaid.test.ts` drives these three cases through real
     mermaid.
- A diagram's CSS cannot leave the diagram. Every rule mermaid emits, including
  a `themeCSS` a directive might set, is compiled through `compileCSS(svgId, …)`,
  which prefixes each selector with the `#<id>` the app generated and comments
  out at-rules outside a fixed list (`:191451-191517`). Ids are app-generated
  (`balade-mermaid-<n>`), never payload-derived.
- Mermaid needs a document, so it loads and draws only from an effect hook in
  the browser: server rendering shows a placeholder and never imports the
  library. A parse or render failure falls back to the diagram source as React
  text with a localized note, which is not an HTML sink
  (`app/src/mermaid/use-mermaid.ts`, `app/src/widgets/mermaid.tsx`).
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
  introduced (`app/src/highlight/shiki.ts:96-232`,
  `app/src/highlight/diff-highlighter.ts:24-86`).
- Diagram coordinates are clamped to 1–64 by both the CLI transform and the
  renderer (`src/contract/diagram.ts`, `app/src/widgets/diagram.tsx`). No
  diagram can make the renderer materialize more than 4,096 grid cells.
- The only payload-derived `href` is `pr.url` (`app/src/ui/chrome.tsx:36`),
  which is GitHub-derived (`src/git/git.ts:239`) and additionally protected by
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
- `POST /api/qa` provides the same body-size service at 64 KiB, strictly decodes
  the request union, and resolves `?path=` through the served-file allowlist
  before reading or writing a sidecar. It rejects every content type except
  `application/json`; a cross-origin browser request therefore requires a CORS
  preflight, and the server grants no CORS permission. A plain HTML form cannot
  spend the reviewer's model quota.
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
  control-stripped in two layers (`src/terminal.ts`): untrusted values pass
  `sanitizeTerminalText` (full strip) where they are interpolated into a
  formatted line, and the stdout/stderr writers admit only the theme's own
  single-parameter SGR color sequences (`sanitizeStyledTerminalText`), so a
  value that skipped the first layer can at worst borrow a palette color —
  conceal, cursor movement and OSC hyperlinks never reach the terminal.
- Standalone attacker-controlled paths reaching git follow `--`. Diff and agent
  inspection pathspecs additionally use `:(literal)` magic
  (`src/git/git.ts:150`, `src/pi/inspection.ts:175`); server metadata lookups
  place `--` before the served path (`src/server/repo.ts:167`). SHA-prefixed
  composites cannot begin with `-`: the SHA is gated by
  `/^[0-9a-f]{40,64}$/u` (`src/git/pr.ts:116`). Frontmatter `commit` is
  validated hex (`src/contract/schema.ts:561`).
- PR-controlled revision names follow `--end-of-options` in
  `git rev-parse --verify --quiet`, so a leading dash remains revision data and
  cannot abort resolution (`src/git/git.ts`).
- Frontmatter key line lookup uses literal string operations. An unknown key
  cannot become regular-expression source or escape the diagnostic channel
  (`src/walkthrough/frontmatter.ts`).
- `?path=` never reaches the filesystem directly: it is allowlist membership
  against the served set (`src/server/api.ts`). The state store independently
  rejects empty, absolute, backslash-containing and dot-segment source paths
  before mirroring the complete repository-relative path below `.balade/`
  (`src/state.ts`, `src/contract/paths.ts`). It canonicalizes the repository
  root and verifies every existing destination component against its expected
  real path before reading, creating or replacing a sidecar, so a symlink below
  `.balade/` cannot redirect the write. Two independent barriers; **no arbitrary
  file write exists.**
- Concurrent first writes recover only from an `AlreadyExists` race, then read
  and revalidate the canonical sidecar. No other creation failure is mistaken
  for a successful competing write.
- The `.balade/` line appended to the clone's `info/exclude` is a module
  constant (`src/state.ts:44`) — **no injection into that file is possible.**
  Its destination directory is `git rev-parse --git-common-dir` output for the
  local clone (`src/shell.ts`), local git metadata a PR head cannot influence.
- Static serving is not traversable: decode → null-reject → normalize →
  prefix-confine (`effect` `HttpStaticServer`), and it registers `GET` only.
  That path does **not** resolve symlinks, so a symlink inside the served root
  would be followed — but the root cannot contain one: it is the hardcoded
  `APP_DIR` beside the CLI with no flag to override it
  (`src/server/http.ts:59`, `:136`); `dist/app` is rollup output with
  `emptyOutDir: true` and no `publicDir` copy step (`app/vite.config.ts:24`);
  no CLI path writes into it; and both `npm pack` and `pnpm pack` were tested to
  strip symlinks from the tarball. **Re-check this if `app/public/` is ever
  added.**

**Agent sandbox**

- Generation and clarification each expose six shared, read-only inspection
  tools plus one workflow-specific submit tool (`src/pi/inspection.ts`,
  `src/pi/session.ts`, `src/pi/clarifier.ts`). No shell, no write, no network.
  The agent cannot execute anything.
- Pinned and base source reads share one repo-relative path gate. It rejects
  credential basenames case-insensitively (`.env*`, auth files, private-key
  formats and credential/secret names) plus `.aws/`, `.ssh/` and `.gnupg/`
  directory segments. The authoring prompt separately forbids reproducing
  credential values and requires an explicit omission note.
- PR and linked-issue URLs from `gh` must parse to repository locations before
  provenance is classified. A malformed location drops the optional GitHub
  enrichment with a notice instead of becoming a guessed third-party label.
- Generation admits changed PR-head `AGENTS.md` and `CLAUDE.md` files only when
  explicitly trusted with `--trust-head-instructions`; clarification always
  omits them. Project-context closing tags are rejected before interpolation in
  both workflows.
- The snapshot is `git archive <pin>` with lexical, symlink and realpath
  containment (`src/pi/snapshot.ts:135-172`, tested in
  `test/snapshot.test.ts:34-71`).
- `search_source` regexes go to ripgrep (Rust regex — linear time, no
  catastrophic backtracking). Results are capped at 200 matches / 80k chars;
  call counts use the shared inspection tier. Live Q&A uses `medium`, while
  generation accepts `low`, `medium` or uncapped `high`.
- Inspection tools reserve their shared search and source-read budgets before
  their first asynchronous operation, so concurrently dispatched calls cannot
  overspend either limit.
- The process installs the balade-owned `RIPGREP_CONFIG_PATH` once before Pi can
  dispatch searches in parallel. No search restores process-global state, so
  every ripgrep spawn retains `--no-ignore` and `--no-follow`.
- Pi credential isolation holds: generation, live clarification,
  `balade agent setup` and `balade agent logout` use one shared model manager
  over balade's own agent directory `~/.balade/pi/` and never read or write
  `~/.pi/agent/`
  (`src/agent/model.ts`, `src/pi/client.ts`, `test/pi-agent-dir.test.ts`, issue #27).
- Logout asks Pi for non-secret credential metadata and delegates each deletion
  to Pi's credential store. Credential values never enter Balade's domain
  model, errors, logs or terminal output.
- The model manager serializes setup and rechecks saved state inside the permit.
  Concurrent first questions can wait for one terminal flow but cannot open
  competing login prompts. The browser receives only `ready` or
  `setup-required` from `GET /api/agent`.
- A clarification starts a fresh in-memory session for every question and
  follow-up. Its prompt labels the walkthrough path, selected passage,
  walkthrough source, prior exchanges and question as untrusted JSON data. Only
  a successful `submit_answer` fragment reaches the compiler; provider details
  do not reach the sidecar or browser, which expose only a generic failed state.
- A restarted server converts abandoned pending sidecar entries to that generic
  failed state on its first read. It never resumes or guesses the outcome of an
  interrupted provider request.

**Export**

- The `</script>` and `<!--` escaping in `src/commands/build/html.ts:43-66` is
  sound and **load-bearing**. The export test drives both sequences through the
  payload and inlined bundle (`test/build.test.ts:189-206`). See the DECISIONS
  entry "The inlined bundle is escaped, the baked payload is JSON-escaped."
- `payload.lang` interpolated into `<html lang>` is constrained to `"en" | "fr"`
  (`src/contract/schema.ts:360`, `:376`).
- The export's meta CSP admits its inline script and style but sets
  `connect-src 'none'`; the served page has a separate policy admitting scripts,
  styles and API calls only from its own origin. Neither policy admits frames,
  forms or a base URL.

**CI**

- No PR-controlled `${{ }}` interpolation, and no `pull_request_target`.
  `release.yml` and `changesets.yml` scope `permissions:` tightly; `ci.yml`
  keeps `contents: read` while its PR-preview step relies on the installed
  pkg.pr.new App instead of a write-capable workflow token
  ([#57](https://github.com/basaltbytes/balade/issues/57)).

## What balade does not defend against

Stating these keeps the model honest.

- **A malicious reviewer's own machine.** balade runs with the reviewer's
  credentials and repository access by design.
- **A compromised dependency at install time.** Exact pinning and a lockfile
  make a swap visible in a diff; they do not stop a malicious version the
  reviewer installs.
- **The provider seeing PR content.** Generation and live clarification send
  pinned diff and source context to the model provider. That is the feature.
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
