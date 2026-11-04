---
"balade": minor
---

Render a pull request's changed files without a walkthrough with the `Diff`
component from `balade/viewer`. Each file takes a path, status, line counts and
a text, binary or omitted patch; a truncated text patch shows a notice. Hosts
can expand files by default, link each file to their own view, and label test
and generated files. Walkthrough files sections render through the same
component and now show "No content changes" for a patch without a hunk.
