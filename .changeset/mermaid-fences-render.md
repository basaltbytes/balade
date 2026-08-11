---
"balade": minor
---

A ```mermaid fence in walkthrough prose now renders as a diagram in the app. Mermaid runs with strict security settings, loads as a separate chunk in the served app, ships inline in static exports, and falls back to the plain source with a note when a diagram does not parse. The authoring guidance encourages a mermaid diagram when it makes the logic clearer than prose, bounds `collapsed=true` to evidence ranges under a substantial Mechanism explanation — code blocks everywhere else stay open — and reserves the grid diagram block for relation maps between changed parts instead of sequential logic.
