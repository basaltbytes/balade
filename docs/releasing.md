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
3. Merging the Version Packages PR runs the same job with nothing left to
   version, so it runs `pnpm changeset:publish`: build, then
   `pnpm stage publish -r --include-workspace-root` stages every workspace
   package whose version npm does not have yet, through OIDC trusted publishing,
   then `scripts/release/tag.mjs` checks the registry. Staged versions are not
   installable until an npm maintainer approves them, so the job logs
   `release_approval_pending` and stops.
4. Approve the staged versions (below). The next run of the `release` job —
   `workflow_dispatch`, or the next push to `main` — finds every version public
   and tags `v<version>` through `changeset git-tag`.

## Approval

After the release job logs `release_approval_pending`, use a local npm account
with publish access to the `@balade` organization and 2FA enabled:

```sh
pnpm stage list
pnpm stage view <stage-id>
pnpm stage approve <stage-id> --otp <code>
```

Review the package name, version and source commit before approving each stage
ID. Approve `@balade/core` first, then `@balade/viewer`, then `balade`, which
depends on both. The **Staged Packages** tab on npmjs.com shows the same list.

Then check the registry, not only the workflow log:

```sh
for name in balade @balade/core @balade/viewer; do pnpm view "$name" version dist-tags.latest; done
```

Re-run `release.yml` from the Actions tab to create the tags once every
version is public.

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
`release.yml`, and keep **Allow npm publish** enabled. `pnpm stage publish`
skips versions npm already has, so the hand-published version is not retried.

## Boundaries

- 0.x semantics apply: a breaking change is a **minor** bump, everything else
  is a **patch** (the changesets default; nothing configured).
- The authoring package version (`src/authoring/package.ts`) is a separate
  line: it versions the walkthrough/prompt contract, not the npm package, and
  follows its own policy in
  [authoring-package.md](authoring-package.md#version-policy). Never wire it
  into changesets.
- The repository pins pnpm 11.20.0 (`devEngines`), which has `pnpm stage` and
  OIDC trusted publishing. `workflow_dispatch` on `release.yml` re-runs the
  version-or-publish-or-tag decision at `main`.
- Preview publication runs only for `pull_request` events, with the CI
  workflow's read-only token and no npm credentials. A newer commit cancels an
  older preview job for the same pull request. All three packages publish to
  pkg.pr.new together, so a preview of `balade` resolves the matching
  `@balade/core` preview.
