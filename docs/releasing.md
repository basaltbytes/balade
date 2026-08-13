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
4. `release.yml` publishes to npm via OIDC trusted publishing —
   `prepublishOnly` runs the full quality gate including the packed-tarball
   smoke test — and creates the GitHub Release on the tag.

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
  older preview job for the same pull request.
