---
"balade": minor
---

Redesign the review app's visual system, and give it a compact-viewport layout.

The palette moves off GitHub's blue-grey onto a near-neutral dark ground, so
syntax highlighting and diff state are the only chromatic things on the page.
The accent, the five status hues and every neutral were regenerated in OKLCH;
every text token now clears WCAG AA contrast on both the page and card
surfaces, which `context` and the open-PR badge did not before.

Authored prose reads at 15px over 1.7 and is capped at 72 characters, while
code, diffs and tables keep the full column: a walkthrough is read for an hour,
and the old 13px body text was an instrument label pressed into service.
Section titles, the PR title and prose headings all move up with it.

Sections now sit on a rail — a continuous line down the document's left margin
with a node at each section that fills as you mark it reviewed, showing review
progress as position rather than only as a count.

Below 768px the walkthrough is usable for the first time. The sidebar's two
jobs split into a fixed bottom bar carrying progress, the section count and
next-unreviewed, and a sheet that opens the full navigation tree, both review
toggles and the clarification list. Split diffs become unified, card grids go
to one column, and touch targets meet 44px.

Container corners are unified at 10px against 6px controls, the active
navigation item drops its accent border for a fill, and text selection, the
caret, focus rings and scrollbars are themed instead of shipping as browser
defaults.
