---
"balade": minor
---

Open every walkthrough with a standalone overview group, and state the voice.

The overview rule required only the id, so a generated walkthrough could fold
its overview into the first thematic group and the sidebar lost its anchor.
`check` now requires the walkthrough to open with a group holding only the
overview section (`overview-group-shared`), so the generation loop repairs a
draft that buries it.

The guidance also gains the authoring voice rules: concrete language over
abstractions-about-abstractions, named calls over role descriptions, explain
why complexity exists instead of describing it, no padding for simple things,
no forced analogies.

Authoring package 1.33.0.
