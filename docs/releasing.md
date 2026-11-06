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
   `pnpm changeset`, pick the packages and the bump, write the release note.
   That note is the CHANGELOG entry, written by the PR that knows the change.
   PRs with no user-facing change add none.
2. On every push to `main`, the `release` job in
   `.github/workflows/release.yml` runs the changesets action. While changesets
   are pending it maintains the rolling **Version Packages** PR: version bumps
   plus the generated `CHANGELOG.md` sections. `package.json` is the CLI's
   version source; the installed binary reads it at startup. The Version
   Packages PR itself runs no CI (it is created with the default
   `GITHUB_TOKEN`, whose events trigger no workflows); its real gate is CI on
   `main` after merge.
3. Merging the Version Packages PR is the review. It runs the same job with
   nothing left to version, so it runs `pnpm changeset:publish`: build, then
   `scripts/release/publish.mjs` runs `pnpm publish` in every workspace package
   whose version npm does not have yet, the root included, through OIDC trusted
   publishing, and waits until the registry serves them. Then
   `scripts/release/tag.mjs` pushes one `v<version>` tag on the commit that set
   that version in `package.json` (not on `main`'s head, in case a re-run
   happens later) and creates the GitHub Release for it with generated notes.
   Every step skips what already exists, so re-running the job
   (`workflow_dispatch`) is safe.

Check the registry when in doubt:

```sh
for name in balade @balade/core @balade/viewer; do pnpm view "$name" version dist-tags.latest; done
```

npm's staged publishing (`pnpm stage publish`, a maintainer approves each
version with 2FA before it becomes public) is not used: the merge is the review,
and nothing tells CI when a staged version is approved, so tagging would need a
second run. Revisit when the library has consumers who would be hurt by a bad
publish.

## Packages

The workspace publishes `balade` (the CLI and its library entry, the workspace
root), `@balade/core` (`packages/core`) and `@balade/viewer`
(`packages/viewer`). `pnpm-workspace.yaml` lists `.` among the packages:
changesets only versions workspace members, and the root is one only when the
globs name it. They share one version: `.changeset/config.json` lists them as a
fixed group, so a changeset for any of them bumps all three.

### A new package

npm accepts a trusted publisher only for a package that already exists, so a
new package's first version is published by hand once, from a logged-in machine
with 2FA:

```sh
pnpm install --frozen-lockfile && pnpm build
pnpm --filter <name> publish --access public --no-git-checks --ignore-scripts --otp <code>
```

Then on npmjs.com, under the package's **Settings → Trusted publisher**, add
GitHub Actions with repository `basaltbytes/balade` and workflow
`release.yml`, and tick **Allow npm publish**: npm creates trusted publishers
as stage-only by default, and the release job publishes directly.
`publish.mjs` skips versions npm already has, so the hand-published version is
not retried.

## Boundaries

- 0.x semantics apply: a breaking change is a **minor** bump, everything else
  is a **patch** (the changesets default; nothing configured).
- The authoring package version (`src/authoring/package.ts`) is a separate
  line: it versions the walkthrough/prompt contract, not the npm package, and
  follows its own policy in
  [authoring-package.md](authoring-package.md#version-policy). Never wire it
  into changesets.
- The repository pins pnpm 11.20.0 (`devEngines`), which publishes through
  OIDC trusted publishing. `workflow_dispatch` on `release.yml` re-runs the
  version-or-publish decision at `main`.
- Preview publication runs only for `pull_request` events, with the CI
  workflow's read-only token and no npm credentials. A newer commit cancels an
  older preview job for the same pull request. All three packages publish to
  pkg.pr.new together, so a preview of `balade` resolves the matching
  `@balade/core` preview.
