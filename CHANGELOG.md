# balade

## 0.12.0

### Minor Changes

- 7880e05: `--budget` now takes `low`, `medium`, or `high`. `medium`, the default, keeps the scaled budget that grows with the pull request's changed-file count. `low` allows one diff read, one search, and one source read per changed file — a constrained spend that still produces a walkthrough. `high` removes the caps. The `base`, `x2`, and `unlimited` names are gone. Authoring package 1.21.0.
- 7b9599e: `balade generate` now reports its lifecycle to herdr when it runs inside a herdr pane: working while authoring, blocked while a login or model prompt waits for input, idle when the walkthrough is done. Detection uses herdr's own pane environment and socket API, so there is nothing to configure, and outside herdr nothing is reported.

### Patch Changes

- 49bad3e: CLI output is colored on interactive terminals: `check` diagnostics paint their error and warning marks, labels, and verdict lines, warnings share a painted three-line shape across commands, and served URLs, generated files, and stop messages are styled. Piped output, `check --json`, and `NO_COLOR` environments keep byte-identical plain text. The terminal-injection guard is documented in docs/threat-model.md: untrusted values are control-stripped where they are interpolated, and the write edge admits only balade's own color codes.

## 0.11.0

### Minor Changes

- 18b6ed2: The core tag catalog now teaches the `pseudo` fence by example, in both of its shapes: condition/action lines for a decision path and an indented call tree for runtime flow. The mermaid entry cedes straight-line algorithm logic to it. Authoring package 1.20.0.

## 0.10.0

### Minor Changes

- 0367335: The authoring guidance now teaches the `pseudo` fence for pseudo-code explanations in the Mechanism group, tells the model not to omit load-bearing files, and states the current fence rendering rules. Authoring package 1.19.0.
- 7f663b3: Top-level fenced code blocks now render in the review app as read-only text — highlighted when the language is known, plain otherwise, so pseudo-code explanations reach the reader. ```mermaid fences still render as diagrams. A fence nested in a blockquote or list keeps the warning.
- e19d463: The authoring skeleton's closing Full PR diff section now demonstrates the grouped `{% filegroup /%}` form, so generated walkthroughs group large diffs into thematic sections instead of leaving one flat file list.
- 328dc0a: `balade generate` now sizes its inspection budget from the pull request's changed-file count, with room for reading files adjacent to the diff, and a new `--budget` flag selects the tier: `base` (scaled), `x2` (doubled), or `unlimited` (no caps). The ten-code-range ceiling and the fixed section suggestions are gone — the walkthrough is sized by the change, not by constants.

## 0.9.1

### Patch Changes

- 675fa9a: `balade generate --prompt "…"` steers one authoring run with reviewer guidance — which part is risky, what to emphasize, what a previous draft missed. The guidance enters the authoring prompt as trusted operator input in its own labeled block, stacks with `--preset`, survives repair turns, and is not recorded in the generated walkthrough.
- dd3b89e: Point the no-walkthrough errors from `open`, `check` and `build` at `npx balade generate`.
- b1e83a0: Print the CLI and authoring package versions when `balade generate` starts.
- f390f77: `balade generate --force` now replaces an existing walkthrough with the same generated filename through an atomic write. Without `--force`, balade warns before authoring when the output directory already holds walkthroughs for that PR, and a completed draft that collides is retained under a unique sibling filename instead of being discarded.

## 0.9.0

### Minor Changes

- 935c363: The `{% flow %}`/`{% step %}` block is removed from the walkthrough format: the contract schema, the compiler, the renderer, and the authoring catalog no longer know it, and `balade check` now reports it as an unknown tag. Sequences and branching belong to the ```mermaid fence, which the authoring catalog now designates for ordered paths; the grid `{% diagram %}` block keeps its relation-map job. Authoring package 1.15.0.

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
