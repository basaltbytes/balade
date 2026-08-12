---
"balade": minor
---

The `{% flow %}`/`{% step %}` block is removed from the walkthrough format: the contract schema, the compiler, the renderer, and the authoring catalog no longer know it, and `balade check` now reports it as an unknown tag. Sequences and branching belong to the ```mermaid fence, which the authoring catalog now designates for ordered paths; the grid `{% diagram %}` block keeps its relation-map job. Authoring package 1.15.0.
