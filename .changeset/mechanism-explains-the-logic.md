---
"balade": minor
---

Walkthroughs can now separate understanding from verification. The `{% code %}` tag accepts `collapsed=true`, so a block starts collapsed in the app and opens with the existing toggle. The authoring guidance teaches the pattern that uses it: when a change carries an algorithm or non-obvious logic worth explaining, a Mechanism section placed right after Orientation explains what the solution does and the logic behind it, and each critical claim carries its real hunk as a collapsed code block the reviewer opens on demand. The Mechanism group replaces the former Deep dive group in the canonical skeleton.
