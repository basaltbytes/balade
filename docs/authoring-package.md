# Authoring package

The versioned authoring data lives in [`src/authoring/`](../src/authoring/):
section templates, core tag catalog, writing rubric, and inspection budgets.
It renders twice — into the Pi system prompt
([`src/pi/authoring.ts`](../src/pi/authoring.ts)) that `balade generate`
loads, and into the generated `balade-authoring` skill
([`src/authoring/skill.ts`](../src/authoring/skill.ts)) that teaches an
external coding agent the same format. The prose of those surfaces lives in
Markdown documents beside their renderers —
[`src/authoring/guidance.md`](../src/authoring/guidance.md) (shared by both),
[`src/authoring/skill.md`](../src/authoring/skill.md), and
[`src/pi/system-prompt.md`](../src/pi/system-prompt.md) — with `{{name}}`
slots carrying the typed data in. The package ships with the CLI, so a
plain `npx balade generate …` does not depend on a second repository or an
installed agent skill.

Live clarification is a narrower consumer of this package. Its dedicated
prompt ([`src/pi/clarification-prompt.md`](../src/pi/clarification-prompt.md))
reuses the core tag catalog and inspection budgets, but asks for a validated
answer fragment rather than a complete walkthrough and does not use the section
templates or writing rubric.

The current package version is `1.31.0`. Its major version matches the
walkthrough schema it authors.

## Contract

The package receives a pull-request snapshot: PR identity, base and head refs,
the pinned commit, changed-file statistics, and the author's stated intent.
When authenticated `gh` data is available, that intent includes the PR title and
body plus the title and available body of each same-repository closing issue.
Git always supplies up to 20 commit subjects from the pinned PR range. If `gh`
is unavailable, generation continues with those commit subjects and reports the
`gh-unavailable` warning.

Closing issues from another repository remain available in a separate
third-party claims block, with a notice that names their repository. The agent
can use this text to guide inspection, but never as evidence of the pull-request
author's intent.

`generate --prompt` adds reviewer guidance to the request. Unlike every
PR-derived string, it is typed by the operator on the command line and enters
the prompt as trusted steering, in its own labeled block after the claims.

All author-stated intent is untrusted text. The agent treats it as claims to
verify against the pinned diff and source, never as facts or instructions. A
walkthrough can call out a material difference between the claim and the code
only when inspected evidence supports it.

Before the first model turn, the authoring session loads the first `AGENTS.md`
or `CLAUDE.md` spelling at the repository root and at each changed path's
ancestor directories. These files come from the pinned commit, not the current
checkout. An instruction file changed by the pull request is omitted with a
warning unless the run explicitly passes `--trust-head-instructions`; unchanged
instructions keep the default behavior. A file containing a project-context
closing tag is always rejected with a warning. Nested instructions apply only
below their directory, and unrelated monorepo instructions are omitted.

The generation session adds seven balade-owned tools: six read-only inspection
tools that list the change and pinned tree, search the pinned snapshot with
fixed text or a regular expression, and read a changed-file diff or numbered
lines at the pin or PR base, plus one structured draft submit tool.
Clarification reuses the same six inspection tools and adds `submit_answer`
instead. A loaded instruction can direct the generation model to read another
project document through the pinned source tool. Neither session can run shell
commands or write files. Every requested path is resolved through the snapshot
root, including symlink targets, before a filesystem-backed tool uses it.
Source reads also reject credential-file basenames and paths below `.aws/`,
`.ssh/`, or `.gnupg/`. The prompt tells the agent to describe credential-related
changes without quoting their values and to state when it omits one.

The pinned tree is extracted with `git archive` into
`~/.balade/cache/snapshots/`. Cache entries are keyed by repository and commit,
and the extracted `tree/` directory contains no cache metadata. Repeat, repair
and clarification turns reuse an entry. Each snapshot open runs a
least-recently-used cleanup that keeps the five newest snapshot entries across
repositories.

The submitted draft contains a title, scalar metadata, an optional preset, and
a complete Markdoc body. Balade owns the envelope. It stamps `walkthrough`,
`pr`, and `commit`, then writes the authoring version under
`meta.balade-authoring`:

```yaml
walkthrough: 1
title: Status-aware retries
pr: 14
commit: 9f3c2ad
meta:
  lang: en
  balade-authoring: 1.31.0
```

The model cannot replace that version. `balade check` parses the written file
through the same walkthrough v1 contract used by hand-authored files and
confirms each code path, range, and `expect=` boundary echo.

Inspection budgets scale with the pull request. The default `medium` tier
allows two diff reads and two searches per changed file, and three source
reads — room for the adjacent files a claim depends on — with floors of
sixteen, thirty, and twenty-four so small changes stay free to explore.
`--budget low` allows one diff read, one search, and one source read per
changed file, with floors of eight, twenty, and twelve — a constrained spend
that still produces a walkthrough; `--budget high` removes enforcement. The budgets exist to guarantee
termination, never to economize on the operator's behalf unless the operator
picks `low` to say exactly that, and a
draft has no cap on sections or code ranges. Search results are repo-relative,
sorted by path and line, capped at 200 matches, and character-truncated. They
do not depend on ignore files or on the user's own ripgrep configuration. The
session installs one balade-owned ripgrep configuration for its whole process,
so parallel tool calls cannot restore a competing configuration between spawn
steps. The budget function lives beside the prompt and is also used by the Pi
tool adapter.

## Version policy

Every prompt, template, rubric, or limit change bumps the package version.

| Part | Bump when |
| --- | --- |
| Major | The walkthrough input schema changes. The authoring major must equal the `walkthrough` schema number. |
| Minor | A rule, template, rubric criterion, or limit can change section choice, evidence selection, or generated prose. |
| Patch | Wording or examples become clearer without changing the expected authoring decisions. |

Fixture expectations change only with a minor or major bump. A patch must keep
the existing decisions and objective checks green.

## Section selection

The package teaches its tags as a language and dictates no outline. It never
shows a finished walkthrough: each tag family carries one example in the block
catalog, and the shared guidance shows small composition moves — such as two
sidebar entries declared under one group — that tests parse against the real
Markdoc config. The prompt addresses the model as the senior engineer
explaining its own work: decide what the reviewer must understand, in what
order, and at what depth.

Two boundaries are fixed and `check` enforces both — the walkthrough opens
with the overview (`id="overview"`) and closes with the Full PR diff group and
its bare `{% files /%}` block. Between them, sections that share a subject sit
under one group labelled in the change's own words, and every section carries
an icon naming its subject.

The same offline evaluation that replays scripted transcripts asserts this
structure on every fixture: an expected draft whose first section is not the
overview, whose sections sit ungrouped or without icons, or whose closing
diff is filtered fails `pnpm test` before any paid generation runs.

The Mechanism sections are there to help a human have a real understanding of the 
code produced in this PR. Explain the overall concepts, the logic, models, actors and
algorithms that are in this PR. This section doesn't need to go over translation files, or 
documentation updates or other transversal or trivial changes, it is used to understand 
pieces of code that are introduced in the PR.

Feel free to use pseudo-code (A markdown fence tagged `pseudo`) to explain difficult logic, to use mermaid diagram flows (A Markdown fence tagged `mermaid` renders as a diagram), UML or any other illustration that may perfectly represent the logic of the code in the PR and help understanding.

If the PR introduce known algorithms, encryption techniques, modelization techniques, feel free
to give link for reading materials and explaination of the software engineering concept.

When explaining the code feel free to directly have the code block shown in-between, in full form
or pinned with `collapsed=true` to disclose it as a "If you want to dive deeper" section.

Markdoc attributes use double quotes. Embedded double quotes need backslash
escapes:

```markdoc
{% method sig="_check_allocation()" decorator="@api.constrains(\"allocation_id\")" %}
```

## Block catalog

The system prompt teaches the exact syntax of every core tag: one example per
block, plus the full node and edge shape of `diagram`, one mermaid fence, and a
pseudo fence in both of its shapes — condition/action lines for a decision
path, an indented call tree for runtime flow. It
also states the cost model — only `code` ranges count against the range budget,
so structured blocks are free — and tells the model to prefer a block over a
prose list whenever the content is enumerable. A test walks `CORE_TAG_NAMES`, so
a tag added to the format cannot silently stay untaught. A preset appends the same kind of
guidance for its own tags: `--preset odoo` adds the `o-` tag syntax and a
what-to-hunt checklist that maps Odoo anatomy to blocks.

The catalog teaches `filegroup`, the self-closing child of `{% files %}` that
groups the rendered diff browser into collapsible thematic sections. A group
carries a required `label`, an optional `only` glob, and an optional `status`
list of A, M, D and R. Path globs support `*` within one segment, `**` across
directories, `?` for one character, and `{a,b}` alternatives. Each brace entry
may be a complete path pattern, so one group can cover several parts of the
tree:

```markdoc
{% files %}
{% filegroup label="Agent and CLI" only="{src/agent/**,src/commands/**,src/cli.ts}" /%}
{% /files %}
```

Tags claim files in authored order: each one takes the changed files its filter
matches among those no earlier tag claimed, and a tag with no filter takes
everything left. Sibling tags with the same exact label resolve to one group at
that label's first position; their claimed paths append in tag order. An empty
tag still warns and adds no paths. Files that no group claims render after the
groups. Grouping therefore partitions the diff instead of filtering it, and
cannot hide a changed file, so a grouped closing block remains the complete
verification surface. The guidance tells the agent to group that closing block
once the pull request touches more than ten files, with labels drawn from the
change itself.

The catalog also teaches the section tag's display attributes. A section
carrying `file="…"` renders in the sidebar as a color-coded changed-file entry,
so the navigation can read like a GitHub file list. `icon="…"` sets the glyph
shown in the sidebar and in the section head. The catalog teaches the icon
vocabulary grouped by the subject each name states — behavior and interfaces,
data and state, flow and history, security, tests, and so on — because a flat
list of names makes the model match an icon to a template position instead of
to the section's subject. For the same reason no narrative template carries an
icon; only the closing full-PR-diff section does, since its subject is fixed.
The renderer maps every taught name plus the chrome and file-status glyphs an
author never writes, the compiler holds the map to that list, and a test holds
the taught vocabulary inside it. A missing or unknown name renders a neutral
dot. `badge="…"` adds a chip beside the
section title, toned by `badgeTone` — `new`, `mod` or `del`, defaulting to the
file status for a file-section and to `mod` otherwise. `generate --lang en|fr` adds a language instruction to
the initial request and stamps `meta.lang`; an explicit flag outranks a
model-supplied value.

## Writing rubric

The evaluator and human review use four questions:

| Criterion | Pass | Reject |
| --- | --- | --- |
| Factual accuracy | Every claim, path, range, and boundary echo matches inspected evidence at the pin. | The draft guesses intent or cites code it did not inspect. |
| Section selection | Each narrative section adds review signal; the required bare full-PR diff remains last. | The narrative inventories files, copies all five narrative groups by habit, draws a diagram that restates a list or a sequence as boxes, or omits, filters, or moves the closing full-PR diff. |
| Reviewer usefulness | The draft explains observable behavior, control flow, constraints, and the proof or risk that matters, and the reader understands the logic of the solution without opening every code range. | It paraphrases syntax, repeats the PR title, or puts a one-line claim above a collapsed code range. |
| Prose quality | A reader who missed the coding session can understand direct, neutral, concrete prose. | The text assumes prior code knowledge or uses vague praise. |

English prose follows ASD-STE100 Simplified Technical English. French prose
uses *Rédaction technique simplifiée* and keeps English technical terms that
French developers normally use.

## Offline comparison

Run the stable comparison suite without provider credentials:

```sh
pnpm eval:authoring
```

Each case creates a throwaway Git repository, commits a base and PR head, and
feeds a scripted Pi `fauxProvider` transcript through the production
`WalkthroughAuthor` adapter. `runGeneration` writes the result and calls the
real `check` pipeline. The suite then compares section choices, code evidence,
and reviewer concepts with the fixture's expected decisions.

The fixtures cover these change shapes:

| Shape | Expected choice |
| --- | --- |
| Feature | Explain the new policy shape and its boundary proof. |
| Refactor | Use one mechanism section; list the removed file without narrating it. |
| Bugfix | Keep the reading path to the boundary fix and regression proof. |
| Mechanical rename | Use one orientation section and no code ranges. |
| Docs-only | Treat the documentation as the changed surface; omit code-anatomy groups. |

Run the suite on the baseline and candidate commits to compare a prompt
revision. The named case results and `check` diagnostics show which authoring
decisions moved.

Provider output has a separate opt-in command:

```sh
BALADE_EVAL_PROVIDER=openai-codex \
BALADE_EVAL_MODEL=gpt-5.4 \
pnpm eval:authoring:paid
```

The paid config runs the same five repositories through the live Pi layer and
uses the same structural checks. Inspect its prose against the rubric. This
suite is excluded from the normal Vitest config and from `pnpm test`.

## The generated skill

`balade skills install` renders the package into a `SKILL.md` and writes it to
`.agents/skills/balade-authoring/` at the repository root — the shared
convention Codex, opencode, Cursor, recent Claude Code, and other agents read.
When `.claude/` already exists it also writes
`.claude/skills/balade-authoring/`; a repository that never uses Claude Code
never grows the folder. The file is generated output, never a source: it
always overwrites, and re-running the command after upgrading balade is the
refresh story. `--out <dir>` renders into one custom
directory instead; the build ships the same rendering at `dist/skill/`, so a
path-based installer such as `npx skills add ./node_modules/balade/dist/skill`
can place it for agents with other layouts.

The skill's frontmatter stamps `balade-authoring: <version>`. `balade check`
scans both conventional directories for that stamp and prints one stderr hint
when it differs from the CLI's own version — re-run the install for a stale
skill, upgrade balade for a newer one. A current or absent skill stays silent,
and the hint never becomes a diagnostic or an exit code: `check`'s own
model-directed fix hints already teach an agent that has no skill at all.

## `code-walkthrough` skill

Balade owns the programmatic package, its version, and its fixture decisions.
The `basaltbytes/skills` `code-walkthrough` rewrite is the interactive wrapper:
it gathers the change in a human-driven agent session, applies the same rubric,
runs the writing and public-copy review skills, calls `balade check`, and opens
diagrams for a visual pass. The skill points to this contract instead of
copying the prompt or rubric as a second source.
