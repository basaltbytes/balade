<p align="center">
  <img src="https://raw.githubusercontent.com/basaltbytes/balade/main/site/public/favicon.png" width="64" height="64" alt="balade: a walking boot over green and red diff squares" />
</p>

<h1 align="center">balade</h1>

<p align="center"><em>Human-readable walkthroughs for diffs too large to scan.</em> · <a href="https://balade.dev">balade.dev</a></p>

<p align="center">
  <a href="https://www.npmjs.com/package/balade"><img src="https://img.shields.io/npm/v/balade" alt="npm version" /></a>
  <a href="https://pkg.pr.new/~/basaltbytes/balade"><img src="https://pkg.pr.new/badge/basaltbytes/balade" alt="pkg.pr.new previews" /></a>
  <a href="https://github.com/basaltbytes/balade/actions/workflows/ci.yml"><img src="https://github.com/basaltbytes/balade/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/balade" alt="MIT license" /></a>
</p>

`balade` transforms big agent-driven PR into a beautiful human-readable PR-walkthrough local webpage. It combines a powerful markdoc authoring system and renders it into a mini webapp with local state to review the PR with interactive components. 

Example output:
<img width="2456" height="1770" alt="balade-pr-screenshot" src="https://github.com/user-attachments/assets/b14c800f-d88b-40d7-88f1-5a4dc820d294" />

Let `balade generate` the PR walkthrough for you by bringing your own model (authentication with OpenAI Codex or Anthropic API Key, based on pi.dev). Or install the skills and let your agent commit the walkthrough Markdoc file that you can then render with `balade open`.

Agents can self-check correctness of the authored walkthrough with `balade check` and good error handling, always gibing you a working PR walkthrough.

## Requirements

- Node.js 22.22.2+, 24.15.0+, or 26+

## Quick start

```sh
# cd into your repo folder and the number of the github PR
npx balade generate 96
```

Or if there is an existing walkthrough to visualize
```sh
# existing walkthrough file
npx balade open .agents/walkthroughs/pr-96-loan-refactor.md
npx balade check .agents/walkthroughs/pr-96-loan-refactor.md
npx balade build .agents/walkthroughs/pr-96-loan-refactor.md
```

## Commands

| Command | Behavior |
| --- | --- |
| `generate <pr>` | Draft, validate and open a walkthrough. Accepts `96`, a PR URL, or `'#96'`. |
| `open [target]` | Start a live review. The target may be a file or PR; omit it to discover all walkthroughs. |
| `check [file]` | Validate one walkthrough, or all discovered walkthroughs. Use `--json` for JSON output. |
| `build <file>` | Write a self-contained HTML file beside the walkthrough. Use `--out` to change the path. |
| `skills install` | Install the bundled authoring skill for coding agents. |

Run `npx balade <command> --help` for all flags.

### Live review

`open` serves the app from the local repository and launches the default
browser. `--no-browser` prints the URL without launching one; `--port` selects
the port, and `--lang en|fr` selects the interface language.

A PR target uses the checked-out walkthrough when available. Otherwise, balade
fetches `pull/<number>/head` and reads the walkthrough from that commit. This
doesn't switch branches or modify the checkout.

Discovery scans tracked files matching `**/walkthroughs/*.md` whose frontmatter
contains `walkthrough`. The default generated path is
`.agents/walkthroughs/`.

### Generate

Run generation inside the repository clone:

```sh
npx balade generate 96
```

Balade pins the PR head, extracts it under `~/.balade/cache/snapshots/`, and
gives the model read-only list, search and source tools. The model can't run
shell commands or write files. Balade keeps the five most recently used
snapshots.

Repository instructions come from the pinned commit. If the PR changes an
`AGENTS.md` or `CLAUDE.md`, balade ignores that file and prints a warning. Pass
`--trust-head-instructions` after reviewing the change. Files containing a
project-context closing tag are rejected.

The first run opens a provider and model picker. Balade stores its Pi credentials
and model default under `~/.balade/pi/`; it doesn't read or modify
`~/.pi/agent/`.

Anthropic subscription login in third-party tools uses billed extra token
usage. It doesn't consume Claude plan limits.

Common options:

```sh
npx balade generate 96 --provider openai-codex --model gpt-5.4
npx balade generate 96 --preset odoo
npx balade generate 96 --lang fr
npx balade generate 96 --dir docs/walkthroughs
npx balade generate 96 --trust-head-instructions
npx balade generate 96 --no-browser
npx balade generate 96 --no-open
```

`--lang` controls the authored language during generation. On `open` and
`build`, it changes only the app interface.

The default output is `.agents/walkthroughs/pr-<number>-<title>.md`. Balade
won't overwrite an existing file. It validates the draft and allows up to two
model repair turns. If validation still fails, the draft stays on disk and the
command exits with status 1.

Use `--no-open` for scripts and CI. Use `--verbose` to print model-visible text and
allowlisted tool calls; provider-hidden reasoning remains hidden.

Generated frontmatter records authoring package version `1.11.0`. See the
[authoring package](docs/authoring-package.md) for the tag catalog, rubric and
version policy.

## Walkthrough format

The frontmatter identifies the PR and commit:

```yaml
---
walkthrough: 1
title: Loan wizard refactor
pr: 96
commit: 9f3c2ad
meta:
  module: acme_loan
  balade-authoring: 1.11.0
---
```

`commit` must be a reachable SHA with 7 to 40 hexadecimal characters. The app
shows a stale notice when the PR head moves past it. `check` reports whether new
commits touch referenced content.

The body uses Markdoc:

```md
{% group label="Models" %}
{% section id="allocation" title="The allocation model" %}
What changed and why.

{% code file="src/models/allocation.py" from=41 to=58 expect="def allocate" /%}
{% /section %}
{% /group %}
```

`expect` must match part of the range's first line. A mismatch fails validation.
The authoring package documents the other blocks and structural rules.

## Review data

Live review marks are stored under `.balade/` at the repository root. On the
first write, balade adds that directory to `.git/info/exclude`. Marks are local
to the clone and reviewer. Unchanged sections retain their marks after a
re-stamp; changed sections reset.

Static exports store review state in browser `localStorage`. An export contains:

- the old and new contents of every changed file, including files absent from
  the walkthrough narrative.
- each full unified diff and the source lines used by code blocks.
- repository, PR, author, branch, commit and walkthrough metadata;
- file paths, author-supplied metadata and validation messages.

Treat the HTML as a copy of the changed repository source. When opened through
`file://`, Chrome may expose its review state to other local `file://` pages in
the same browser profile. The state contains no source code, but it identifies
the repository, PR, commit, walkthrough and changed paths. Serve sensitive
exports from a dedicated HTTP origin.

## Authoring with another agent

Install the generated authoring skill into the repository:

```sh
npx balade skills install
```

This writes `.agents/skills/balade-authoring/SKILL.md`. If the repository has a
`.claude/` directory, it also writes
`.claude/skills/balade-authoring/SKILL.md`. Re-run the command after upgrading
balade. Anyway `check` will report a version mismatch.

Use `--out <dir>` for another skill layout (other coding agent harnesses). The npm package also includes the rendered skill under `dist/skill/`.

## CI

This workflow validates walkthroughs changed by a pull request:

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

The workflow requires no write permission and doesn't post to the pull request.

## License

[MIT](LICENSE) © Philippe L'ATTENTION
