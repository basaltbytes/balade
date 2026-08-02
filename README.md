# balade

`balade` renders a thin, committed walkthrough file into an interactive
pull-request review app. The file is prose plus references — sections, code
ranges, fields, tests, a file browser — and the CLI resolves those references
against git at the commit the file is stamped with, so the narration and the
code cannot drift apart unnoticed. Nothing is duplicated into the walkthrough:
diffs, blobs and PR metadata are read from the repository at run time.

## Usage

No install needed; the package ships the app bundle.

```sh
npx balade open   walkthroughs/pr-96-loan-refactor.md   # serve the review app on localhost
npx balade build  walkthroughs/pr-96-loan-refactor.md   # write one self-contained HTML file
npx balade check  walkthroughs/pr-96-loan-refactor.md   # validate; exit code is the contract
```

- `open` with no file discovers every walkthrough in the repository and serves
  an index. `--lang en|fr` sets the chrome language, `--port` the port.
- `build` takes exactly one file and writes `<name>.html` beside it, or
  wherever `--out` says. The HTML carries the app and the resolved payload
  inline: no server, no network, no sibling assets.
- `check` with no file validates every discovered walkthrough. `--json` prints
  the report as JSON.

Discovery is git-tracked files matching `**/walkthroughs/*.md` whose
frontmatter holds the `walkthrough` key.

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
