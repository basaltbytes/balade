---
"balade": minor
---

Reject a repeated group label, and teach composition from a fictional domain.

A generated walkthrough came back with every narrative group labeled with the
guidance's own example label: the composition example was drawn from a real
walkthrough, so when a pull request matched its domain the model took the
example label as the sanctioned answer and repeated it. The example now comes
from a fictional pull request and says so.

`check` also gains `group-label-duplicate`: two groups sharing a label is a
broken outline, reported as an error on the second occurrence, so a generated
draft that repeats a label is repaired in the generation loop instead of
reaching the reviewer.

Authoring package 1.33.0.
