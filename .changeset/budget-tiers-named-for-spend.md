---
"balade": minor
---

`--budget` now takes `low`, `medium`, or `high`. `medium`, the default, keeps the scaled budget that grows with the pull request's changed-file count. `low` allows one diff read, one search, and one source read per changed file — a constrained spend that still produces a walkthrough. `high` removes the caps. The `base`, `x2`, and `unlimited` names are gone. Authoring package 1.21.0.
