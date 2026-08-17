<p align="center">
  <img src="https://raw.githubusercontent.com/basaltbytes/balade/main/site/public/favicon.png" width="64" height="64" alt="balade: a walking boot over green and red diff squares" />
</p>

<h1 align="center">balade</h1>

<p align="center"><em>Human-readable walkthroughs for diffs too large to scan.</em> · <a href="https://balade.dev">balade.dev</a></p>

<p align="center">
  <a href="https://www.npmjs.com/package/balade"><img src="https://img.shields.io/npm/v/balade" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/status-alpha-orange" alt="Status: alpha" />
  <a href="https://pkg.pr.new/~/basaltbytes/balade"><img src="https://pkg.pr.new/badge/basaltbytes/balade" alt="pkg.pr.new previews" /></a>
  <a href="https://github.com/basaltbytes/balade/actions/workflows/ci.yml"><img src="https://github.com/basaltbytes/balade/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/balade" alt="MIT license" /></a>
</p>

`balade` turns large, agent-generated pull requests into guided, human-readable
walkthroughs. It connects explanations to the exact code, validates them
against git, and tailors the complete diff for human review. Balade has its own components and review format in a Markdoc file that you can commit to your repo.

You probably already have an AI review pipeline; balade comes after. It organizes, reframes and explains the changes so humans keep a strong understanding of the codebase.

Example output:
<img width="2456" height="1770" alt="balade-pr-screenshot" src="https://github.com/user-attachments/assets/b14c800f-d88b-40d7-88f1-5a4dc820d294" />

Browse a live walkthrough: [balade.dev/demo](https://balade.dev/demo/).

Let `balade generate` draft the walkthrough with your own model (sign in with
OpenAI Codex or an Anthropic API key; built on pi.dev). Or install the
authoring skill and let your coding agent commit the walkthrough Markdoc file,
then render it with `balade open`.

Agents self-check what they authored with `balade check`: validation errors
say exactly what to fix, so the walkthrough you open is a working one.

## Requirements

- Node.js 22.22.2+, 24.15.0+, or 26+

## Quick start

```sh
# cd into your repo folder and generate with the number of the github PR
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
| `agent setup` | Authenticate and choose the model used by generation and live Q&A. |
| `agent logout` | Remove every provider credential stored by Balade. |
| `skills install` | Install the bundled authoring skill for coding agents. |

Run `npx balade <command> --help` for all flags.

### Live review

`open` serves the app from the local repository and launches the default
browser. `--no-browser` prints the URL without launching one; `--port` selects
the port, and `--lang en|fr` selects the interface language.

During a live review, select text inside a walkthrough section and choose
**Ask agent**. Balade anchors the question to that section and passage, runs a
fresh agent against the walkthrough and pinned pull-request diff, and shows the
answer in a local thread. Section badges reopen earlier exchanges and each
thread accepts follow-up questions. A **Clarifications** section in the sidebar
keeps every pending, answered and failed thread reachable, including when its
drawer is closed or several questions are running. If no usable Balade login
and model are configured, the first question opens one-time provider and model
prompts in the terminal that started `balade open`, then submits the original
question automatically. Run `balade agent setup` to configure it ahead of time.
Clarifications are unavailable in static exports. Run `balade agent logout` to
remove stored Balade logins and exercise first-run setup again. Credentials
supplied through the environment remain available.

```sh
npx balade agent setup
npx balade agent setup --provider openai-codex --model gpt-5.4
npx balade agent logout
```

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

The first agent-powered run opens a provider and model picker. Balade stores its
Pi credentials and model default under `~/.balade/pi/`; it doesn't read or
modify `~/.pi/agent/`. Generation, `agent setup`, `agent logout`, and live Q&A
share this one configuration.

Anthropic subscription login in third-party tools uses billed extra token
usage. It doesn't consume Claude plan limits.

Common options:

```sh
npx balade generate 96 --provider openai-codex --model gpt-5.4
npx balade generate 96 --preset odoo
npx balade generate 96 --lang fr
npx balade generate 96 --prompt "focus on the migration; the cache change is the risky part"
npx balade generate 96 --budget low
npx balade generate 96 --dir docs/walkthroughs
npx balade generate 96 --force
npx balade generate 96 --trust-head-instructions
npx balade generate 96 --no-browser
npx balade generate 96 --no-open
```

`--lang` controls the authored language during generation. On `open` and
`build`, it changes only the app interface.

`--prompt` steers one run with what you already know about the change — which
part is risky, what to emphasize, what a previous draft missed. It stacks with
`--preset` and is not recorded in the generated file.

`--budget` sizes how much the model may inspect. Both sized tiers scale with
the pull request's changed-file count: `medium`, the default, keeps slack for
paging and adjacent files, while `low` allows one read of each kind per
changed file — a constrained spend that still yields a walkthrough. `high`
removes the caps entirely.

The default output is `.agents/walkthroughs/pr-<number>-<title>.md`. Balade
decides what happens to an existing walkthrough for the same PR and language
before the model runs. One stamped at an older head is refreshed: the run
replaces it, even when the new title picks a different filename. One stamped at
the current head prompts before replacing; scripts and CI stop instead, and
`--force` skips the question. If a replaced file had uncommitted changes, a
copy is kept beside it as `<file>.superseded` — committed content needs no
copy, git already has it. Walkthroughs in another language are left untouched,
and `--dir` writes elsewhere to keep both.

Balade validates the draft and allows up to two model repair turns. If a turn
leaves the same diagnostic codes on the same lines, balade stops early. If
validation still fails, the draft stays on disk and the command exits with
status 1.

Use `--no-open` for scripts and CI. Use `--verbose` to print model-visible text and
allowlisted tool calls; provider-hidden reasoning remains hidden.

Generated frontmatter records authoring package version `1.21.0`. See the
[authoring package](docs/authoring-package.md) for the tag catalog, rubric and
version policy.

Inside a [herdr](https://github.com/herdrdev/herdr) pane, `generate` reports
its state over herdr's socket API: working while it authors, blocked while a
login or model prompt waits for you, done when the walkthrough is ready. No
setup is needed; outside herdr the reporting is off.

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
  balade-authoring: 1.21.0
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
A top-level fenced code block renders as read-only text — highlighted when the
language is known, plain otherwise, so pseudo-code works. A fence tagged
`mermaid` renders as a diagram. A fence nested in a blockquote or list does not
reach the app. The authoring package documents the other blocks and structural
rules.

A walkthrough ends with a `{% files /%}` block, the full-PR diff browser that
lists every changed file with a viewed mark. That block can hold
`{% filegroup /%}` children to group the browser into collapsible sections:

```md
{% files %}
{% filegroup label="Tests" only="**/*.test.ts" /%}
{% filegroup label="UI" only="app/**" /%}
{% filegroup label="Misc" /%}
{% /files %}
```

A group takes a required `label`, an optional `only` glob and an optional
`status` list of A, M, D and R. Groups claim files in authored order: each one
takes the changed files its filter matches among those no earlier group claimed,
and a group with no filter takes the rest. Files no group claims render after
the groups. Grouping splits the full diff, it doesn't filter it, so no changed
file disappears from the browser.

## Review data

Live review marks are stored under `.balade/` at the repository root. On the
first write, balade adds that directory to `.git/info/exclude`. Marks are local
to the clone and reviewer. Unchanged sections retain their marks after a
re-stamp; changed sections reset. The directory mirrors each walkthrough's full
repository-relative path, so `.agents/walkthroughs/pr-133.md` stores marks in
`.balade/.agents/walkthroughs/pr-133.md.review.json` and cannot collide with a
same-named walkthrough elsewhere.

Live clarification threads use the matching `.qa.json` sidecar beside the
marks. They belong to one walkthrough commit and are discarded when its PR or
stamp changes. Answers are compiled through the same validated block format as
the walkthrough, but never modify the walkthrough file or appear in a static
export. If the walkthrough changes while it is open, a new question is rejected
with a prompt to reload so it cannot attach to a different generation. If the
server process stops before an answer finishes, opening the walkthrough again
marks that question failed and keeps the thread available for a follow-up.

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
balade; if the installed skill is stale, `check` reports the version mismatch.

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
