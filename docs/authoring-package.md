# Authoring package

`balade generate` loads one versioned package from
[`src/generate/authoring.ts`](../src/generate/authoring.ts). It contains the
system prompt, section templates, writing rubric, and inspection limits. The
package ships with the CLI, so a plain `npx balade generate …` does not depend
on a second repository or an installed agent skill.

The current package version is `1.1.0`. Its major version matches the
walkthrough schema it authors.

## Contract

The package receives a pull-request snapshot: PR identity, base and head refs,
the pinned commit, and changed-file statistics. Before the first model turn,
the authoring session loads the first `AGENTS.md` or `CLAUDE.md` spelling at the
repository root and at each changed path's ancestor directories. These files
come from the pinned commit, not the current checkout. Nested instructions apply
only below their directory, and unrelated monorepo instructions are omitted.

The session adds five read-only tools. They list the change and pinned tree,
read a changed-file diff, read numbered lines from a pinned blob, and submit one
structured draft. A loaded instruction can direct the model to read another
project document through the pinned source tool. The session cannot run shell
commands or write files.

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
  balade-authoring: 1.1.0
```

The model cannot replace that version. `balade check` parses the written file
through the same walkthrough v1 contract used by hand-authored files and
confirms each code path, range, and `expect=` boundary echo.

One turn may read at most eight diffs and twelve source ranges. A draft may
contain at most ten code ranges. Those limits live beside the prompt and are
also used by the Pi tool adapter.

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

The package starts from the pr-96 navigation skeleton, but it does not copy all
five groups into every draft.

| Group | Use it for |
| --- | --- |
| Orientation | The review frame: what changed, why it matters, and the constraint that shapes it. This group is always present. |
| Models | Domain types, persisted state, components, or services whose structure carries the change. |
| Surface | UI, API, CLI, configuration, or documentation behavior that a caller, operator, or user can observe. |
| Quality | Tests, security, migrations, or translations that provide review evidence. Each selected topic gets its own section. |
| Deep dive | One algorithm, lifecycle, state transition, or compatibility boundary that needs a slower reading path. |

A changed file does not earn a section by itself. Mechanical renames can use
one orientation section plus a `files` block. When an empty area expresses a
product rule, the draft explains the absence with Markdown and a callout; it
does not create a one-card block.

Markdoc attributes use double quotes. Embedded double quotes need backslash
escapes:

```markdoc
{% method sig="_check_allocation()" decorator="@api.constrains(\"allocation_id\")" %}
```

## Writing rubric

The evaluator and human review use four questions:

| Criterion | Pass | Reject |
| --- | --- | --- |
| Factual accuracy | Every claim, path, range, and boundary echo matches inspected evidence at the pin. | The draft guesses intent or cites code it did not inspect. |
| Section selection | Each section adds review signal; low-signal files and topics stay out of the reading path. | The draft inventories files or copies the full skeleton by habit. |
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

## `code-walkthrough` skill

Balade owns the programmatic package, its version, and its fixture decisions.
The `basaltbytes/skills` `code-walkthrough` rewrite is the interactive wrapper:
it gathers the change in a human-driven agent session, applies the same rubric,
runs the writing and public-copy review skills, calls `balade check`, and opens
diagrams for a visual pass. The skill points to this contract instead of
copying the prompt or rubric as a second source.
