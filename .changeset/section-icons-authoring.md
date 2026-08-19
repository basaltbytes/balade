---
"balade": minor
---

Teach section icons and badges in the authoring package, so a generated
walkthrough's navigation shows what each section is about.

The section tag has always accepted `icon=`, `badge=` and `badgeTone=`, but the
authoring package never mentioned them. A generated walkthrough therefore
carried an icon only on the closing full-PR-diff section, whose template ships
one, and every other entry in the sidebar rendered the neutral `dot-fill`
fallback.

The tag catalog now documents the three attributes and names the octicons the
renderer maps, and all six section templates carry an icon. The accepted names
live in one list that the renderer's map must cover — the compiler enforces
that, and a test compares the list against the vocabulary the package teaches,
so a name cannot be taught that does not render. `check` is unchanged: an icon
stays optional, and an unrecognized name still falls back to a dot.

Authoring package 1.22.0.
