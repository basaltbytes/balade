---
"balade": minor
---

Require a walkthrough to open with its overview.

`check` already refuses a walkthrough that does not end with the unfiltered
full-PR diff. It now refuses one that does not start with the overview: the
first section carries `id="overview"`, and anything else reports
`overview-section-missing` with the line of the offending section.

The authoring package states the rule in the same place it states the closing
one, so a generated draft that opens with something else is repaired in the
generation loop rather than reaching the reviewer.

Authoring package 1.28.0.
