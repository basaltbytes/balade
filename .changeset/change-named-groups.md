---
"balade": minor
---

Teach walkthrough structure by exemplar and procedure instead of a skeleton.

The authoring package shipped a canonical skeleton of five named groups, and
generated walkthroughs copied it: the same five headings in every sidebar,
each above a single section, whatever the pull request contained. Rules added
against that copying accumulated into prose the skeleton itself contradicted.

The package now leads with two complete exemplar walkthroughs — a feature
change and a documentation-only change — in which every structural convention
appears correct: the overview opens, every section sits in a group labelled in
the change's own words and carries a subject icon, evidence sits under its
claim, the bare full-PR diff closes. A four-step procedure replaces the
skeleton prose, and the five former group names survive only as the list of
candidate subjects. The offline evaluation now asserts that structure on every
fixture, so a prompt regression fails `pnpm test` instead of a paid run.

Authoring package 1.29.0.
