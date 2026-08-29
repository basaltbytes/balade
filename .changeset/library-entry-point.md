---
"balade": minor
---

Add a library entry point: `import { generate, check, build } from "balade"` runs the three commands from a script or a CI job without a terminal. `generate` takes the command's options plus an explicit `model` and `onProgress`; it never prompts — an unresolved model, a missing credential or an existing same-head walkthrough without `force: true` rejects with a tagged error whose `message` is the sentence the command prints. `check` returns the report, `build` the outcome. The published package now carries type declarations and an `exports` map.
