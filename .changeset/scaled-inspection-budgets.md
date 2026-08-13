---
"balade": minor
---

`balade generate` now sizes its inspection budget from the pull request's changed-file count, with room for reading files adjacent to the diff, and a new `--budget` flag selects the tier: `base` (scaled), `x2` (doubled), or `unlimited` (no caps). The ten-code-range ceiling and the fixed section suggestions are gone — the walkthrough is sized by the change, not by constants.
