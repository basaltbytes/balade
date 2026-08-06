---
"balade": patch
---

Releases are now cut by changesets: each pull request declares its own release note, CI maintains a rolling "Version Packages" pull request, and merging that publishes to npm with a generated CHANGELOG.
