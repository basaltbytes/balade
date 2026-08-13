---
"balade": patch
---

`balade generate --force` now replaces an existing walkthrough with the same generated filename through an atomic write. Without `--force`, balade warns before authoring when the output directory already holds walkthroughs for that PR, and a completed draft that collides is retained under a unique sibling filename instead of being discarded.
