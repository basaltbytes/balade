# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two readers, weighted equally. Neither is the default scene; a design that
serves one at the other's expense is wrong.

- **The author of the agent-generated pull request.** They drove the coding
  agent and are reading their own PR before pushing it or asking anyone to look
  at it. Their job is self-verification: confirming the agent did what they
  believe it did, and finding the place where it did not.
- **The reviewer who did not write it.** A teammate handed a pull request they
  had no part in producing, at a size no one reads line by line. Their job is
  comprehension of unfamiliar code they will nonetheless be accountable for.

Both are developers, reading inside their own repository clone or from an
exported copy of it.

## Product Purpose

`balade` renders a thin, committed walkthrough file into an interactive
pull-request review app. A coding agent (or `balade generate`) authors the
walkthrough as Markdoc; the CLI validates every claim it makes against git and
serves it as a guided document beside the complete diff.

It exists because agent-scale diffs broke the review surfaces built for
human-scale ones. Reading a 4,000-line PR file by file does not produce
understanding of it. `balade` runs after whatever AI review pipeline a team
already has: those tools judge the change, `balade` explains it, so the humans
on the repository keep a working model of their own codebase.

Success is a reader who finishes the walkthrough able to say what changed, why,
and where the risk is — and who trusts that account because the tool checked it
against the repository rather than repeating what a model asserted.

## Positioning

The explanation is bound to the code and validated against git. Every code
excerpt names a file, a line range, and an `expect` string that must match the
range's first line at the stamped commit; a mismatch fails validation, and
`check` reports whether newer commits touch referenced content. A walkthrough
that renders is one whose claims still hold. Prose alone cannot make that
promise, and neither can a review comment.

Three further commitments a neighboring product could not truthfully copy
without becoming this one:

- **The walkthrough is a file the repository owns.** Markdoc, committed,
  diffable, reviewable, and readable without the tool.
- **Bring your own model.** Generation and live Q&A run on the reader's own
  OpenAI Codex sign-in or Anthropic key. There is no balade service in the path.
- **Local and open source.** MIT, published on npm, run from the clone. Source
  never leaves the machine.

## Operating Context

Three reading scenes the app must support:

1. **Desktop, served locally.** `balade open` (or the tail of `balade generate`)
   serves the app from the repository clone and opens a browser. The full
   feature set is here: review marks persisted to `.balade/`, and clarification
   threads that run a fresh agent against the walkthrough and pinned diff.
2. **Static export, shared.** `balade build` writes one self-contained HTML file
   carrying the changed sources and diffs. It reaches someone who never ran the
   CLI — attached to a PR, hosted, or passed around. No agent, no server; review
   state lives in `localStorage` and clarifications are unavailable.
3. **Phone or tablet.** Reading a walkthrough away from the desk is a real
   scene, not a courtesy. Today's layout does not serve it: the navigation
   sidebar is hidden below the `md` breakpoint with nothing in its place.

Surrounding facts of use: the reader is inside a git working copy; GitHub is
where the pull request lives and where code excerpts deep-link; the walkthrough
is authored by an agent through the bundled authoring skill or by `generate`;
CI can validate walkthroughs with `balade check` without write permission.

## Capabilities and Constraints

**What the app does.** Renders a validated payload as a guided document: a
navigation tree over groups and sections, prose and structured blocks (code
excerpts with plain/change/diff views, mermaid diagrams, tables, cards,
fences), per-section and per-file review marks with progress, a staleness
notice when the PR head has moved past the stamped commit, error cards for
validation diagnostics, and a closing full-PR diff browser that lists every
changed file whether or not the narrative mentions it. Live sessions add
clarification threads: select a passage, ask, and the answer arrives compiled
through the same validated block format.

**Terminology** (the contract's words, and the ones users must see): walkthrough,
group, section, block, code excerpt, files block and filegroup, review mark,
clarification thread, the pinned commit and its stamp, head distance,
preset, budget, authoring package.

**Constraints that bind design work.**

- `src/contract/types.ts` is the contract between the CLI and every renderer.
  The app renders what the payload carries; it does not invent data.
- Every string derived from a pull request is untrusted, including the
  repository's own files at the PR head. Render sinks are a trust boundary —
  see `docs/threat-model.md`.
- Served and exported pages declare separate Content-Security-Policies; the
  served one is `default-src 'none'` with `img-src data:`. No external fonts,
  scripts, styles, or image hosts.
- The export is one self-contained HTML file. Weight added to the app is weight
  added to every export.
- Chrome strings ship in `en` and `fr` and live in `app/src/i18n.ts`. No
  user-visible English is hardcoded in a component. French runs longer than
  English; layouts must survive it.
- Content is unbounded and reader-supplied: section counts, title lengths, file
  paths, diff sizes, and mermaid graphs all arrive from a real pull request.
- Pre-alpha at 0.x. Breaking changes are the norm; obsolete paths get removed
  rather than wrapped in compatibility layers.

**Undecided, deliberately.** Whether the app supports a light color scheme is
open — it is dark-only today (`color-scheme: dark`). Nothing has been decided
about how the three reading scenes are weighted against each other when they
conflict.

## Brand Commitments

- Name: `balade`, lowercase. Domain `balade.dev`. MIT, © Philippe L'ATTENTION,
  published under `basaltbytes`.
- Tagline in use: *Human-readable walkthroughs for diffs too large to scan.*
- Mark: a walking boot over green and red diff squares
  (`site/public/favicon.png`).
- Voice for anything public-facing: plain and technical. Facts stated in prose,
  no marketing cadence and no poetic abstraction. Open source, bring-your-own-
  model, committable, and local are the points that get made explicitly.
- The interface language set is `en` and `fr`.
- **Familiarity with GitHub is deliberate and binding.** Everyone reading a
  balade walkthrough already reads code on GitHub. The app was built to look
  like it — Primer dark tokens, Octicons, the PR-header and diff conventions —
  so a reviewer opening it needs no orientation and spends their attention on
  the change instead of on the interface. Future work stays inside that
  vocabulary. It is not a surface to depart from.
- **Familiar, but original and modern — not a GitHub clone.** Familiarity is
  the floor, not the ceiling. The target is a surface that reads as native to
  the reviewer's habits while being clearly its own thing, and current rather
  than an imitation of whatever GitHub shipped last. Both halves bind: a
  redesign that abandons the familiarity fails, and so does one that only
  copies.

## Evidence on Hand

- A live walkthrough at [balade.dev/demo](https://balade.dev/demo/), built from
  a real PR in this repository.
- A screenshot of real output in the README.
- Fixture payload `app/src/fixtures/pr96.ts`, which is what `pnpm dev:app`
  renders — the real data shape, available offline.
- Committed walkthroughs under `.agents/walkthroughs/`.
- `docs/threat-model.md`, `docs/authoring-package.md`, `DECISIONS.md`.

No customers, testimonials, case studies, press, adoption numbers, or
benchmarks exist. Future work must not invent them.

## Product Principles

1. **The reader's understanding is the deliverable.** Not coverage, not marks
   collected, not time on page. Every element earns its place by making the
   change easier to hold in your head.
2. **Nothing is asserted that git has not confirmed.** The tool's value is that
   its explanations are checked. Anything the app shows as fact must be
   traceable to the payload, and the payload to the stamped commit.
3. **Explain the logic, then show the evidence.** A section says what the code
   does and why before it shows the hunk that does it. The diff supports the
   explanation; it is not the explanation.
4. **The full diff is never hidden.** Grouping and narrative organize the
   change; they never filter it. No changed file disappears.
5. **Untrusted until rendered safe.** Content comes from a pull request. The
   surface treats it as hostile input, and that treatment costs the reader
   nothing.

## Accessibility & Inclusion

WCAG 2.2 AA is the target future work is held to — contrast, focus order,
keyboard reachability, and reduced-motion support. Nothing verifies it today:
ARIA is applied ad hoc, no automated check gates it, and there is no
`prefers-reduced-motion` handling despite the app's smooth-scroll navigation.
Recorded as a commitment, not as a current state.

Sessions are long and text-dense, and a reader may work through a walkthrough
for an hour. Sustained readability at that length is part of the requirement,
not a refinement of it.
