---
"balade": patch
---

CLI output is colored on interactive terminals: `check` diagnostics paint their error and warning marks and verdict lines, `generate` shows an animated activity spinner while the model works, and served URLs, generated files, and stop messages are styled. Piped output, `check --json`, and `NO_COLOR` environments keep byte-identical plain text. The terminal-injection guard is unchanged in substance and documented in docs/threat-model.md: untrusted values are still control-stripped, and the write edge admits only balade's own color codes.
