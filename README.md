# balade

`balade` renders a thin, committed walkthrough file into an interactive
pull-request review app — a guided reading of a change, at reading altitude,
for diffs too large to scan line by line. The file is prose plus references —
sections, code ranges, diagrams, fields, tests, a file browser — and the CLI
resolves those references against git at the commit the file is stamped with,
so the narration and the code cannot drift apart unnoticed. Nothing is duplicated into the walkthrough:
diffs, blobs and PR metadata are read from the repository at run time.

## Usage

No install needed; the package ships the app bundle.

```sh
npx balade generate https://github.com/acme/tools/pull/96 # draft, check and open a live review
npx balade open   .agents/walkthroughs/pr-96-loan-refactor.md   # review in your browser, live
npx balade open   https://github.com/acme/tools/pull/96 # review a PR's walkthrough — no checkout needed
npx balade build  .agents/walkthroughs/pr-96-loan-refactor.md   # write one self-contained HTML file
npx balade check  .agents/walkthroughs/pr-96-loan-refactor.md   # validate; exit code is the contract
```

- `generate` takes a bare pull-request number such as `96`, a pull-request URL,
  or the quoted `'#96'` form. It reads the PR at an exact commit, asks a
  Pi-backed coding agent to draft the walkthrough, then
  runs the same checks used in CI and opens the passing draft as a live review.
  `--no-open` stops after generation for scripts and CI. See
  [Generating a walkthrough](#generating-a-walkthrough).
- `open` starts a live review session — a local server backed by the
  repository, with source refresh and review state in `.balade/` — and opens
  it in your default browser. `--no-browser` serves headless and prints the
  URL only, for CI and remote shells; if the browser cannot be launched, the
  server keeps running and the CLI prints the URL with a recovery hint.
- `open` with no file discovers every walkthrough in the repository, prints how
  many it found, and serves an index. `--lang en|fr` sets the chrome language,
  `--port` the port.
- `open` also takes a pull request — a bare number such as `96`, a URL, or the
  quoted `'#96'` form. When the branch is checked out the walkthrough is served
  from the working tree; otherwise balade fetches the PR's own `pull/96/head`
  ref and reads it from there. Reviewing needs a clone of the repository, not a
  checkout of the branch.
- `build` is the other review mode: one self-contained HTML export whose
  payload is fixed at build time and whose review state stays in browser
  storage. It takes exactly one file and writes `<name>.html` beside it, or
  wherever `--out` says — no server, no network, no sibling assets.
- `check` with no file validates every discovered walkthrough. `--json` prints
  the report as JSON.

### What an export contains

An export contains the full contents of every changed file at both revisions,
including files the walkthrough never narrates. The same HTML also carries each
full unified diff, the raw lines used by code blocks, and review metadata such as
the repository, PR, author, branches, commit SHA, walkthrough path, file paths,
author-supplied metadata, and check messages. Treat the export as a copy of the
changed repository source when deciding where to share it.

Each code excerpt links from its header to that file and starting line in the
pull request's GitHub diff, so the authoritative hunk and commenting controls
stay one click away. Live reviews and self-contained exports both include it.

Discovery is git-tracked files matching `**/walkthroughs/*.md` whose
frontmatter holds the `walkthrough` key — including the default
`.agents/walkthroughs/`, since the pattern matches at any depth.

`balade` requires Node 22.22.2+, 24.15.0+, or 26+.

## Generating a walkthrough

Run generation inside a clone of the repository:

```sh
npx balade generate '#96'
```

If the PR branch is checked out, balade uses its current head. Otherwise it
fetches the exact object advertised by `pull/96/head` without changing your
checkout or `FETCH_HEAD`. Balade extracts that commit under
`~/.balade/cache/snapshots/`, then exposes only its read-only search, list, and
read tools over those files. The model can inspect the diff and source without
seeing a dirty working tree, another branch, or repository history. Before
analysis, balade also loads the `AGENTS.md` or `CLAUDE.md` instructions that
apply to the changed paths from the same commit. It never substitutes files
from another checked-out branch. The model can't run shell commands or write
files.

Snapshots are reused by repository and commit. Balade retains the five most
recently used snapshots and removes older entries when generation starts, so
repeat and repair turns avoid another extraction without leaving an unbounded
cache.

On the first run, the provider picker offers Anthropic subscription login,
OpenAI Codex subscription login, and API-key methods through Pi. Balade keeps
its own Pi state — credentials and the saved model default — in `~/.balade/pi/`
and never reads or writes `~/.pi/agent/`, so an existing pi CLI setup is never
observed or modified; log in once inside balade even if you already use Pi.
Balade hands login prompts to Pi and never reads or prints the credential file.

Anthropic has a billing rule you should know before choosing it: subscription
login in third-party tools bills per token as **extra usage** and doesn't draw
on Claude plan limits. Balade shows this warning in the picker and again when
the chosen model is announced.

Choose a provider/model in the picker; generation starts right away. Automation
can supply both ids and skip the picker:

```sh
npx balade generate 96 --provider openai-codex --model gpt-5.4
npx balade generate 96 --provider openai-codex
npx balade generate 96 --preset odoo # activate a preset's tags for this walkthrough
npx balade generate 96 --lang fr     # author the walkthrough in French
npx balade generate 96 --trust-head-instructions # apply reviewed instruction changes
npx balade generate 96 --dir docs/walkthroughs
npx balade generate 96 --no-browser # serve and print the URL without launching a browser
npx balade generate 96 --no-open    # generate, print the path and exit
```

Every choice becomes balade's saved default and is reused on the next run when
it is available. A valid `--provider` and `--model` pair selects and
saves that model without prompts. A partial, empty, or unavailable value opens
the picker, narrowed to matching models when possible; `--model ""` opens the
full available list.

The default output is `.agents/walkthroughs/pr-96-<title>.md`. Balade stamps the PR
number and commit itself, reports each inspection phase once, reports cumulative
token usage and cost after every model turn, and won't overwrite a file with the
same name. The author works within bounded diff and source inspection budgets so
the baseline draft stays focused. A failed check goes back to the model for at
most two repair turns. `--dir` is repository-relative; paths through symlinks
outside the repository and paths inside `.git` are rejected.

`--preset <name>` activates a preset for the run: balade teaches the author that
preset's tags and stamps `preset:` in the frontmatter, so the tags are active
when `check` reads the draft. Without the flag no preset is used, and the author
is told not to invent one. `odoo` is the preset that ships today; an unknown name
fails before any model runs. A preset can also be activated by hand — add
`preset: odoo` to a walkthrough's frontmatter.

`--lang en|fr` sets the walkthrough's language: the author writes the title and
all prose in it, and balade stamps `meta.lang`, which also drives the app
chrome. Without the flag the draft is authored in English. (On `open` and
`build`, `--lang` only overrides the chrome at render time; it does not rewrite
authored prose.)

Repository instructions from `AGENTS.md` and `CLAUDE.md` are loaded from the
pinned pull-request commit. If the pull request adds or edits one of those
files, balade leaves it out of the authoring prompt and prints a warning. After
reviewing the changed instructions, pass `--trust-head-instructions` to apply
them for that run. Files that contain a project-context closing tag are always
rejected and reported.

Generated frontmatter records the prompt, template, and rubric version under
`meta.balade-authoring`. See the [authoring package](docs/authoring-package.md)
for its contract, version policy, writing rubric, and offline comparison suite.

After a successful check, balade starts the same live review session as
`balade open <generated-file>` and launches it in the default browser. Use
`--no-browser` to keep the server headless and print its URL, and `--port` to
choose its port. Browser-launch failures keep the server running and print the
URL with a recovery hint.

Use `--no-open` for scripts and CI that need generation to print the generated
path and the exact `balade open …` command, then exit without starting a server.

Use `--verbose` to show assistant-visible text, every allowlisted Pi tool input
and result, and the successful code-range report. Provider-hidden reasoning and
terminal control sequences are never printed.

Generation never stages, commits, pushes, or opens a pull request. If the draft
still fails validation, balade keeps the file, never starts a server, and exits
with status 1; edit the reported lines, then check it again:

```sh
npx balade check .agents/walkthroughs/pr-96-loan-refactor.md
```

## Teach your agent the format

An agent can also author the walkthrough by hand — Claude Code, Codex,
opencode, Cursor, or any tool that reads skills. Install the generated
authoring skill into the repository:

```sh
npx balade skills install
```

This writes `.agents/skills/balade-authoring/SKILL.md` — the shared
convention Codex, opencode, Cursor, recent Claude Code, and most other agents
read. When the repository already has a `.claude/` folder, it also writes
`.claude/skills/balade-authoring/SKILL.md`, so a repo that never uses Claude
Code never grows one. The skill teaches the format, the tag catalog, the
writing rubric, and the author-check-repair loop; `balade check` remains the
authority the agent converges against. Re-run the command after upgrading
balade — `check` prints a one-line hint when the installed skill is older
than the CLI.

For an agent with another skills layout, `npx balade skills install --out
<dir>` renders into one custom directory, and the npm package ships the same
rendering at `dist/skill/` for path-based installers.

## The walkthrough file

The frontmatter is the anchor:

```yaml
---
walkthrough: 1                # input schema version
title: Loan wizard refactor
pr: 96                        # the pull request this narrates
commit: 9f3c2ad…              # the stamped commit every reference resolves at
meta:                         # scalar header chips
  module: acme_loan
  balade-authoring: 1.10.0    # generated drafts record their authoring package
---
```

`commit` is a SHA (7 to 40 hex characters) that must be reachable in the clone.
Every code range, blob and diff resolves at that commit; when the PR head moves
past it, the app shows a stale banner and `check` says whether the new commits
touch anything the walkthrough shows. Re-stamp with a newer SHA to clear it.

## Review state

Marks — a checkmark per section, a "Viewed" checkbox per file — are stored in
one JSON file per walkthrough under `.balade/` at the repository root. On first
write the CLI appends `.balade/` to the clone's `.git/info/exclude` (the shared
git directory when reviewing from a linked worktree), so the state is ignored
without touching the committed `.gitignore`. State is local to the
clone and to the reviewer; it is not shared. A mark records the content hash it
was made against, so a re-stamp keeps the marks whose content is unchanged and
resets the rest.

The static export has no server to write to and keeps the same state in
`localStorage`, under the key the payload carries. When opened directly over
`file://`, Chrome makes that state readable to other local `file://` pages in
the same browser profile. The state contains no source code, but it identifies
the repository, PR, walkthrough, commit, and changed-file paths. Serve the
export from a dedicated HTTP origin when those details are sensitive.

## CI

Paste this workflow to have every pull request that touches a walkthrough
validated:

```yaml
name: balade check
on:
  pull_request:
    paths: ["**/walkthroughs/*.md"]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # check resolves blobs at the stamped SHA
      - uses: actions/setup-node@v4
      - run: npx balade check
```

It posts nothing on the pull request and needs no write permission. The link to
the walkthrough in the PR description stays a manual authoring step.
