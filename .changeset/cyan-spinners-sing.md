---
"balade": patch
---

CLI output is colored on interactive terminals: `check` diagnostics paint their error and warning marks, labels, and verdict lines, warnings share a painted three-line shape across commands, and served URLs, generated files, and stop messages are styled. Piped output, `check --json`, and `NO_COLOR` environments keep byte-identical plain text. The terminal-injection guard is documented in docs/threat-model.md: untrusted values are control-stripped where they are interpolated, and the write edge admits only balade's own color codes.
