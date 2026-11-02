---
"balade": minor
---

Compile walkthroughs into resolved payloads with `compilePayload` and
`compilePayloadEffect`. Supply full base/head SHAs and optional PR header facts
without requiring GitHub CLI or default-branch discovery. `check` and `build`
accept `--base`/`--head`; `build --format json` writes the resolved payload.

Expose the browser-safe `balade/contract` decoder and `PAYLOAD_FORMAT`. Payloads
now carry `format: 1`, require an HTTP or HTTPS PR link, and leave review-storage
keys to the renderer. Recompile previously stored payloads from their walkthrough
source; `headDistance` records staleness at compile time.
