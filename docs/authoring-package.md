# Authoring package

The versioned authoring data lives in [`src/authoring/`](../src/authoring/):
section templates, core tag catalog, writing rubric, and inspection limits.
It renders twice — into the Pi system prompt
([`src/pi/authoring.ts`](../src/pi/authoring.ts)) that `balade generate`
loads, and into the generated `balade-authoring` skill
([`src/authoring/skill.ts`](../src/authoring/skill.ts)) that teaches an
external coding agent the same format. The package ships with the CLI, so a
plain `npx balade generate …` does not depend on a second repository or an
installed agent skill.

The current package version is `1.8.0`. Its major version matches the
walkthrough schema it authors.

## Contract

The package receives a pull-request snapshot: PR identity, base and head refs,
the pinned commit, changed-file statistics, and the author's stated intent.
When authenticated `gh` data is available, that intent includes the PR title and
body plus the title and available body of each linked closing issue. Git always
supplies up to 20 commit subjects from the pinned PR range. If `gh` is
unavailable, generation continues with those commit subjects and reports the
`gh-unavailable` warning.

All author-stated intent is untrusted text. The agent treats it as claims to
verify against the pinned diff and source, never as facts or instructions. A
walkthrough can call out a material difference between the claim and the code
only when inspected evidence supports it.

Before the first model turn, the authoring session loads the first `AGENTS.md`
or `CLAUDE.md` spelling at the repository root and at each changed path's
ancestor directories. These files come from the pinned commit, not the current
checkout. Nested instructions apply only below their directory, and unrelated
monorepo instructions are omitted.

The session adds seven balade-owned read-only tools. They list the change and
pinned tree, search the pinned snapshot with fixed text or a regular expression,
read a changed-file diff, read numbered lines at the pin or PR base, and submit
one structured draft. A loaded instruction can direct the model to read another
project document through the pinned source tool. The session cannot run shell
commands or write files. Every requested path is resolved through the snapshot
root, including symlink targets, before a filesystem-backed tool uses it.

The pinned tree is extracted with `git archive` into
`~/.balade/cache/snapshots/`. Cache entries are keyed by repository and commit,
and the extracted `tree/` directory contains no cache metadata. Repeat and
repair turns reuse an entry. On each open, a least-recently-used cleanup keeps
the five newest snapshot entries across repositories.

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
  balade-authoring: 1.8.0
```

The model cannot replace that version. `balade check` parses the written file
through the same walkthrough v1 contract used by hand-authored files and
confirms each code path, range, and `expect=` boundary echo.

One turn may read at most eight diffs, run twenty source searches, and read
twelve source ranges across the pin and base. Search results are repo-relative,
sorted by path and line, capped at 200 matches, and character-truncated. They
do not depend on ignore files or on the user's own ripgrep configuration. A
draft may contain at most ten code ranges. Those limits live beside the prompt
and are also used by the Pi tool adapter.

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

The package starts from the pr-96 navigation skeleton. It selects only the
narrative groups that add review signal, then appends the mandatory full-PR diff.

| Group | Use it for |
| --- | --- |
| Orientation | The review frame: what changed, why it matters, and the constraint that shapes it. This group is always present. |
| Models | Domain types, persisted state, components, or services whose structure carries the change. |
| Surface | UI, API, CLI, configuration, or documentation behavior that a caller, operator, or user can observe. |
| Quality | Tests, security, migrations, or translations that provide review evidence. Each selected topic gets its own section. |
| Deep dive | One algorithm, lifecycle, state transition, or compatibility boundary that needs a slower reading path. |
| Full PR diff | The final verification sweep. This group is always last and its closing section contains a bare `{% files /%}` block. |

A changed file does not earn a narrative section by itself. Mechanical renames
can use one orientation section before the required full-PR diff. That final
block stays attribute-free so every changed file remains available for review
and its Viewed checkbox. When an empty area expresses a product rule, the draft
explains the absence with Markdown and a callout; it does not create a one-card
block.

Markdoc attributes use double quotes. Embedded double quotes need backslash
escapes:

```markdoc
{% method sig="_check_allocation()" decorator="@api.constrains(\"allocation_id\")" %}
```

## Block catalog

The system prompt teaches the exact syntax of every core tag: one example per
block, plus the full node and edge shape of `diagram`. It also states the cost
model — only `code` ranges count against the range budget, so structured blocks
are free — and tells the model to prefer a block over a prose list whenever the
content is enumerable. A test walks `CORE_TAG_NAMES`, so a tag added to the
format cannot silently stay untaught. A preset appends the same kind of
guidance for its own tags: `--preset odoo` adds the `o-` tag syntax and a
what-to-hunt checklist that maps Odoo anatomy to blocks.

The catalog also teaches file-sections: a section carrying `file="…"` renders
in the sidebar as a color-coded changed-file entry, so the navigation can read
like a GitHub file list. `generate --lang en|fr` adds a language instruction to
the initial request and stamps `meta.lang`; an explicit flag outranks a
model-supplied value.

## Writing rubric

The evaluator and human review use four questions:

| Criterion | Pass | Reject |
| --- | --- | --- |
| Factual accuracy | Every claim, path, range, and boundary echo matches inspected evidence at the pin. | The draft guesses intent or cites code it did not inspect. |
| Section selection | Each narrative section adds review signal; the required bare full-PR diff remains last. | The narrative inventories files, copies all five narrative groups by habit, or omits, filters, or moves the closing full-PR diff. |
| Reviewer usefulness | The draft explains observable behavior, control flow, constraints, and the proof or risk that matters. | It paraphrases syntax or repeats the PR title. |
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
