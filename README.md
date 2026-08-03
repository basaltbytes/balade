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
npx balade generate https://github.com/acme/tools/pull/96 # draft, check and save a walkthrough
npx balade open   walkthroughs/pr-96-loan-refactor.md   # serve the review app on localhost
npx balade open   https://github.com/acme/tools/pull/96 # serve a PR's walkthrough — no checkout needed
npx balade build  walkthroughs/pr-96-loan-refactor.md   # write one self-contained HTML file
npx balade check  walkthroughs/pr-96-loan-refactor.md   # validate; exit code is the contract
```

- `generate` takes a pull-request URL, `#96`, or `96`. It reads the PR at an
  exact commit, asks a Pi-backed coding agent to draft the walkthrough, then
  runs the same checks used in CI. See [Generating a walkthrough](#generating-a-walkthrough).
- `open` with no file discovers every walkthrough in the repository and serves
  an index. `--lang en|fr` sets the chrome language, `--port` the port.
- `open` also takes a pull request — the URL, or `#96`. When the branch is
  checked out the walkthrough is served from the working tree; otherwise balade
  fetches the PR's own `pull/96/head` ref and reads it from there. Reviewing
  needs a clone of the repository, not a checkout of the branch.
- `build` takes exactly one file and writes `<name>.html` beside it, or
  wherever `--out` says. The HTML carries the app and the resolved payload
  inline: no server, no network, no sibling assets.
- `check` with no file validates every discovered walkthrough. `--json` prints
  the report as JSON.

Discovery is git-tracked files matching `**/walkthroughs/*.md` whose
frontmatter holds the `walkthrough` key.

`balade` requires Node 22.22.2+, 24.15.0+, or 26+.

## Generating a walkthrough

Run generation inside a clone of the repository:

```sh
npx balade generate '#96'
```

If the PR branch is checked out, balade uses its current head. Otherwise it
fetches the exact object advertised by `pull/96/head` without changing your
checkout or `FETCH_HEAD`. The model can inspect the diff and read numbered
source lines at that exact commit; it can't run shell commands or write files.

On the first run, the provider picker offers Anthropic subscription login,
OpenAI Codex subscription login, and API-key methods through Pi. Existing Pi
credentials in `~/.pi/agent/auth.json` work without another login. Balade hands
login prompts to Pi and never reads or prints the credential file.

Anthropic has a billing rule you should know before choosing it: subscription
login in third-party tools bills per token as **extra usage** and doesn't draw
on Claude plan limits. Balade prints this warning before confirmation.

Choose and confirm a provider/model in the picker. Automation can supply both
ids and skip the prompts:

```sh
npx balade generate 96 --provider openai-codex --model gpt-5.4
npx balade generate 96 --dir docs/walkthroughs
```

The default output is `walkthroughs/pr-96-<title>.md`. Balade stamps the PR
number and commit itself, reports each inspection phase once, reports cumulative
token usage and cost after every model turn, and won't overwrite a file with the
same name. The author works within bounded diff and source inspection budgets so
the baseline draft stays focused. A failed check goes back to the model for at
most two repair turns. `--dir` is repository-relative; paths through symlinks
outside the repository and paths inside `.git` are rejected.

After a successful check, balade prints the generated path and the exact
`balade open …` command to start reviewing it. Generation itself doesn't start
the review server.

Generation never stages, commits, pushes, or opens a pull request. If the draft
still fails validation, balade keeps the file and exits with status 1; edit the
reported lines, then check it again:

```sh
npx balade check walkthroughs/pr-96-loan-refactor.md
```

## The walkthrough file

The frontmatter is the anchor:

```yaml
---
walkthrough: 1                # input schema version
title: Loan wizard refactor
pr: 96                        # the pull request this narrates
commit: 9f3c2ad…              # the stamped commit every reference resolves at
meta:                         # free domain keys, shown as header chips
  module: acme_loan
---
```

`commit` is a SHA (7 to 40 hex characters) that must be reachable in the clone.
Every code range, blob and diff resolves at that commit; when the PR head moves
past it, the app shows a stale banner and `check` says whether the new commits
touch anything the walkthrough shows. Re-stamp with a newer SHA to clear it.

## Review state

Marks — a checkmark per section, a "Viewed" checkbox per file — are stored in
one JSON file per walkthrough under `.balade/` at the repository root. On first
write the CLI appends `.balade/` to `.git/info/exclude`, so the state is
ignored without touching the committed `.gitignore`. State is local to the
clone and to the reviewer; it is not shared. A mark records the content hash it
was made against, so a re-stamp keeps the marks whose content is unchanged and
resets the rest.

The static export has no server to write to and keeps the same state in
`localStorage`, under the key the payload carries.

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
