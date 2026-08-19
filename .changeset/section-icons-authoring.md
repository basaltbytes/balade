---
"balade": minor
---

Teach section icons and badges in the authoring package, so a generated
walkthrough's navigation shows what each section is about.

The section tag has always accepted `icon=`, `badge=` and `badgeTone=`, but the
authoring package named none of them. A generated walkthrough therefore carried
an icon only on the closing full-PR-diff section, whose template ships one, and
every other entry in the sidebar rendered the neutral `dot-fill` fallback.

The catalog now teaches the three attributes. The icon vocabulary is grouped by
the subject each name states, so the model picks by meaning; no narrative
template carries an icon, because an icon shipped in a template gets copied by
position instead of chosen. The renderer's map grew from 48 names to 89 to cover
the subjects walkthroughs actually have — state, workflow, agents, defects,
translations, packaging — and the compiler holds the map to the canonical list
while a test holds the taught vocabulary inside it.

`check` is unchanged: an icon stays optional, and an unrecognized name still
falls back to a dot.

Authoring package 1.23.0.
