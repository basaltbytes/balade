# balade

## 0.8.0

### Minor Changes

- 1bcf72f: The closing `{% files %}` block now accepts `{% filegroup label="Tests" only="**/*.test.ts" /%}` children, and the app renders the full-PR diff browser as collapsible thematic sections. A group takes a required `label`, an optional `only` glob and an optional `status` list of A, M, D and R; groups claim files in authored order, each taking the changed files its filter matches among those no earlier group claimed, and a group with no filter takes the rest. Files that no group claims still render after the groups, so grouping partitions the diff instead of filtering it and cannot hide a changed file. The authoring guidance teaches the syntax and the partition rule, and tells the agent to group the closing block once a pull request touches more than ten files, with labels drawn from the change itself.
- 83645eb: A ```mermaid fence in walkthrough prose now renders as a diagram in the app. Mermaid runs with strict security settings, loads as a separate chunk in the served app, ships inline in static exports, and falls back to the plain source with a note when a diagram does not parse. The authoring guidance encourages a mermaid diagram when it makes the logic clearer than prose, bounds `collapsed=true` to evidence ranges under a substantial Mechanism explanation — code blocks everywhere else stay open — and reserves the grid diagram block for relation maps between changed parts instead of sequential logic.

## 0.7.0

### Minor Changes

- 6b9d3c8: Walkthroughs can now separate understanding from verification. The `{% code %}` tag accepts `collapsed=true`, so a block starts collapsed in the app and opens with the existing toggle. The authoring guidance teaches the pattern that uses it: when a change carries an algorithm or non-obvious logic worth explaining, a Mechanism section placed right after Orientation explains what the solution does and the logic behind it, and each critical claim carries its real hunk as a collapsed code block the reviewer opens on demand. The Mechanism group replaces the former Deep dive group in the canonical skeleton.

### Patch Changes

- 5f15abd: Keep walkthrough generation from reading credential files, identify linked issues from other repositories as third-party claims, and keep concurrent source searches inside the pinned snapshot.
- 5024432: Bound syntax highlighting and diagram rendering for attacker-controlled pull-request content, and keep crafted frontmatter keys and ref names from crashing or aborting the CLI.
- c473955: Harden the local review server against DNS rebinding, oversized review-state bodies, clickjacking, and filesystem-path disclosure in error responses.
- de33745: Show the balade boot-and-diff favicon across the site, review app, and standalone exports.
- aec0bc7: Use shell-safe bare pull-request numbers in command guidance and announce when `balade open` serves every discovered walkthrough.
- 4dcc674: Describe balade by its value — human-readable walkthroughs for agent-scale pull requests — in the CLI help, the walkthrough index subtitle, and the package description, instead of the "committed, validated" shorthand.

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
