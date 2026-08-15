---
"balade": minor
---

`balade generate` now reports its lifecycle to herdr when it runs inside a herdr pane: working while authoring, blocked while a login or model prompt waits for input, idle when the walkthrough is done. Detection uses herdr's own pane environment and socket API, so there is nothing to configure, and outside herdr nothing is reported.
