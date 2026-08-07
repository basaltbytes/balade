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

Repository instruction files (`AGENTS.md` / `CLAUDE.md`) are handled
differently — they are loaded as instructions the agent is told to follow
(`src/pi/authoring.ts:33`, `src/pi/session.ts:507-538`). They are currently read
from the **PR head**, which an attacker controls: see
[#61](https://github.com/basaltbytes/balade/issues/61).

Linked issues are fetched with the reviewer's own GitHub token and are not
restricted to the same repository:
[#60](https://github.com/basaltbytes/balade/issues/60).

### 2. PR bytes → the renderer

`balade open <pr-url>` compiles a walkthrough read straight from the untrusted
PR head, and displays file bytes from it
(`src/commands/open/locator.ts:102-122`, `src/server/repo.ts:106-109`).

Nothing from the PR head executes on the machine: the head is never checked out,
so no hook, filter or `.gitattributes` rule applies; `git show` emits raw blobs;
Markdoc registers no variables, functions or partials
(`src/walkthrough/config.ts:11-16`); and compilation is a pure transform into a
JSON payload of plain data. The exposure is the browser origin.

The reviewer is currently given no signal that this is happening:
[#69](https://github.com/basaltbytes/balade/issues/69).

### 3. The local review server

Binds `127.0.0.1` with no host flag (`src/server/http.ts:22-23`). Five routes;
one mutating endpoint, `PUT /api/state`.

Loopback binding stops off-machine connections. It does not stop DNS rebinding,
and no request header is validated:
[#63](https://github.com/basaltbytes/balade/issues/63).

### 4. The export bundle

`balade build` inlines the app and payload into one HTML file, meant to be
opened over `file://` ([DECISIONS.md](../DECISIONS.md), "The export bundle
carries every grammar"). It embeds the **full contents of every changed file at
both revisions** — see [#67](https://github.com/basaltbytes/balade/issues/67)
for the complete inventory and the sharing position.

### 5. Supply chain and CI

Dependencies are pinned exact; publishing uses OIDC trusted publishing with no
long-lived token ([docs/releasing.md](releasing.md)). Actions are pinned by
mutable tag: [#58](https://github.com/basaltbytes/balade/issues/58).

## Verified invariants

These were checked against source during the audit of
[#50](https://github.com/basaltbytes/balade/issues/50). They are the baseline a
change must not silently break — cite them, and re-verify if you touch the code
they describe.

**Payload decoding**

- Both payload entry points decode with `onExcessProperty: "error"`
  (`app/src/data/source.ts:29-32`, baked `:124`, served `:112`);
  `window.__BALADE__` is typed `unknown`. Enforced, not conventional.
- The schema is **shape-only** — no length, bound or protocol refinements. See
  [#72](https://github.com/basaltbytes/balade/issues/72).

**Rendering**

- The `Inline` contract has **no link and no HTML kind** — the union is
  `string | array | {c} | {b} | {i} | {m} | {tag}`
  (`src/contract/schema.ts:19-47`). The compiler drops link and image shells and
  keeps only their text (`src/walkthrough/inline.ts:41`). A walkthrough
  structurally cannot express a link. This is the strongest control in the app.
- `Rich` (`app/src/ui/rich.tsx`) renders every branch as a React text child. No
  `href`, no `style` from data, no HTML sink.
- Exactly **one** `dangerouslySetInnerHTML` (`app/src/widgets/code.tsx:129`),
  fed by shiki over payload text; grammars are a closed 31-entry allowlist
  falling back to `"text"` (`app/src/highlight/shiki.ts:74-77`).
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

- **No shell strings anywhere.** Every git, gh and browser invocation goes
  through `spawnSync(file, [...args])` with no `shell: true`
  (`src/shell.ts:41-46`, `src/server/browser.ts:73`). Terminal output is
  control-stripped at the edge (`src/terminal.ts:13-28`).
- Attacker-controlled paths reaching git are `--`-guarded with `:(literal)`
  pathspec magic (`src/git/git.ts:135-145`, `src/pi/session.ts:195-206`,
  `src/server/repo.ts:158`). SHA-prefixed composites cannot begin with `-`: the
  SHA is gated by `/^[0-9a-f]{40,64}$/u` (`src/git/pr.ts:117`). Frontmatter
  `commit` is validated hex (`src/contract/schema.ts:441`).
- `git rev-parse --verify --quiet` is inert for every dash-leading argument
  shape — it spawns no process and writes no file. See
  [#70](https://github.com/basaltbytes/balade/issues/70) for the evidence and
  the residual DoS.
- `?path=` never reaches the filesystem: it is allowlist membership against the
  served set (`src/server/api.ts:124-137`). State filenames keep only the
  basename (`src/state.ts:63-67`). Two independent barriers; **no arbitrary file
  write exists.**
- The `.balade/` line appended to `.git/info/exclude` is a module constant
  (`src/state.ts:39`) — **no injection into that file is possible.**
- Static serving is not traversable: decode → null-reject → normalize →
  prefix-confine (`effect` `HttpStaticServer`), and it registers `GET` only.

**Authoring sandbox**

- A seven-tool allowlist, all read-only (`src/pi/session.ts:302-319`). No shell,
  no write, no network. The agent cannot execute anything.
- The snapshot is `git archive <pin>` with lexical, symlink and realpath
  containment (`src/pi/snapshot.ts:135-172`, tested in
  `test/snapshot.test.ts:34-71`).
- `search_source` regexes go to ripgrep (Rust regex — linear time, no
  catastrophic backtracking), bounded to 20 searches / 200 matches / 80k chars.
- Pi credential isolation holds: balade uses its own agent directory
  `~/.balade/pi/` and never reads or writes `~/.pi/agent/`
  (`src/pi/client.ts:81-105`, `test/pi-agent-dir.test.ts`, issue #27).

**Export**

- The `</script>` and `<!--` escaping in `src/commands/build/html.ts:37-62` is
  sound and **load-bearing** — today's bundle contains eleven `<!--` and four
  `<script>` sequences. See the DECISIONS entry "The inlined bundle is escaped,
  the baked payload is JSON-escaped" and `test/build.test.ts:144`.
- `payload.lang` interpolated into `<html lang>` is constrained to `"en" | "fr"`
  (`src/contract/schema.ts:339`).

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

**Position: run a branch-scoped security review before each release.** The
`/security-review` skill already exists in-repo, and releases are already a
deliberate, changesets-driven checkpoint
([docs/releasing.md](releasing.md)) — so the cadence attaches to something that
already happens rather than inventing a new ritual.

Two things make it worth more than a ritual:

- The **verified invariants** above give the review a concrete checklist. Most
  of them are one-line greps.
- Any PR that touches a trust boundary — the payload schema, the render sinks,
  the tool allowlist, the server routes, the export HTML, or a workflow file —
  should say in its changeset which invariant it affects, or state that it
  affects none.
