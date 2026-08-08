# balade

## 0.6.3

### Patch Changes

- 054d9fa: Disclose the source embedded in static exports, warn when a fetched PR head supplies unreviewed walkthrough content, and restrict export and served pages with content-security policies.
- 52ee0a0: Keep pull-request changes to `AGENTS.md` and `CLAUDE.md` out of the authoring prompt unless `generate --trust-head-instructions` explicitly enables them, reject project-context closing tags, and report authoring startup failures with action-specific guidance.

## 0.6.2

### Patch Changes

- 9fdf589: Review state is now git-excluded when reviewing from a linked worktree or a submodule. The CLI resolves the clone's real git directory (`git rev-parse --git-common-dir`) instead of assuming `.git` is a directory at the repository root, so `.balade/` lands in the shared `info/exclude` and never shows up in `git status`.

## 0.6.1

### Patch Changes

- 78ca297: Releases are now cut by changesets: each pull request declares its own release note, CI maintains a rolling "Version Packages" pull request, and merging that publishes to npm with a generated CHANGELOG.
