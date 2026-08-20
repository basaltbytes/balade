---
"balade": minor
---

Teach walkthrough structure as a language, never as a document to copy.

The authoring package shipped a canonical skeleton of five named groups, and
generated walkthroughs copied it: the same five headings in every sidebar,
each above a single section, whatever the pull request contained. Rules added
against that copying accumulated into prose the skeleton itself contradicted.

The package now teaches its tags as a language and dictates no outline. It
never shows a finished walkthrough: the block catalog carries one example per
tag family, and the guidance shows small composition moves, such as two
sidebar entries declared under one group. The prompt addresses the model as
the senior engineer explaining its own work, with two enforced boundaries (the
overview opens, the bare full-PR diff closes) and two standing expectations
(every section sits in a change-named group and carries a subject icon). The
offline evaluation asserts that structure on every fixture, so a prompt
regression fails `pnpm test` instead of a paid run.

Authoring package 1.32.0.
