# Releasing

Releases are driven by [changesets](https://github.com/changesets/changesets).
There is no local publish step.

Pull requests have a separate preview path. The `npm-package` job in
`.github/workflows/ci.yml` builds and smoke-tests the packed tarball, then runs
`pkg-pr-new publish` once from the lockfile. The installed pkg.pr.new GitHub App
posts an `npx` command on the pull request. Preview packages never reach npm and
do not create versions, tags or GitHub Releases.

## The flow

1. A PR that changes user-facing behavior adds a changeset — run
   `pnpm changeset`, pick the bump, write the release note. That note is the
   CHANGELOG entry, written by the PR that knows the change. PRs with no
   user-facing change add none.
2. On every push to `main`, `.github/workflows/changesets.yml` folds pending
   changesets into a rolling **Version Packages** PR: version bump plus the
   generated `CHANGELOG.md` section. `package.json` is the CLI's version source;
   the installed binary reads it at startup, so `changeset version` has no
   second version constant to synchronize. The Version Packages PR itself runs
   no CI (it is created with the default
   `GITHUB_TOKEN`, whose events trigger no workflows); its real gates are CI
   on `main` after merge and `prepublishOnly` at publish.
3. Merging the Version Packages PR runs the same workflow with nothing left to
   version, so it tags `v<version>` and dispatches `release.yml` on that tag.
   The dispatch is explicit (`gh workflow run release.yml --ref v<version>`)
   because tags pushed with the default `GITHUB_TOKEN` never trigger another
   workflow, and the repository holds no long-lived token that would.
4. `release.yml` runs the full quality gate once (`pnpm release:check`,
   including the packed-tarball smoke test of all three packages), publishes
   `@balade/core` and `@balade/viewer`, then `balade`, to npm via OIDC trusted
   publishing, and creates the GitHub Release on the tag.

## Packages

The workspace publishes `balade` (the CLI and its library entry),
`@balade/core` (`packages/core`) and `@balade/viewer` (`packages/viewer`).
They share one version: `.changeset/config.json` lists them as a fixed group,
so a changeset for any of them bumps all three. Pick the packages a change
affects when running `pnpm changeset`.

A new package's first version is published by hand, because npm accepts a
trusted publisher only for a package that exists:

1. Make sure the `@balade` npm organization exists and you own it.
2. Before merging the Version Packages PR that first versions the package,
   check out its branch (`changeset-release/main`), run
   `pnpm install --frozen-lockfile && pnpm build`, then
   `pnpm --filter <name> publish --access public --no-git-checks --ignore-scripts --otp <code>`.
3. On npmjs.com, add `basaltbytes/balade` and `release.yml` as the package's
   trusted publisher.
4. Merge the Version Packages PR. `pnpm -r publish` in `release.yml` skips a
   version npm already has, so the hand-published package is not retried. If
   `release.yml` already ran and failed on the new package, publish it by hand
   from the tag instead and re-run `release.yml` on the tag.

After every release, check the published versions on the registry
(`npm view <name> version`), not only the workflow log.

## Boundaries

- 0.x semantics apply: a breaking change is a **minor** bump, everything else
  is a **patch** (the changesets default; nothing configured).
- The authoring package version (`src/authoring/package.ts`) is a separate
  line: it versions the walkthrough/prompt contract, not the npm package, and
  follows its own policy in
  [authoring-package.md](authoring-package.md#version-policy). Never wire it
  into changesets.
- Manual fallbacks: `workflow_dispatch` on `changesets.yml` re-runs the
  version-or-tag decision at `main`; `workflow_dispatch` on `release.yml`
  publishes whatever version the chosen ref carries.
- Preview publication runs only for `pull_request` events, with the CI
  workflow's read-only token and no npm credentials. A newer commit cancels an
  older preview job for the same pull request. All three packages publish to
  pkg.pr.new together, so a preview of `balade` resolves the matching
  `@balade/core` preview.
