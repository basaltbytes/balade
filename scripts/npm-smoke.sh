#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/balade-npm-smoke.XXXXXX")"
export npm_config_cache="$TMP_ROOT/npm-cache"

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

cd "$ROOT"

pnpm build

TARBALL="$TMP_ROOT/balade-smoke.tgz"
pnpm pack --out "$TARBALL" >/dev/null

PACKAGE_VERSION="$(node -p "require('./package.json').version")"
PROJECT="$TMP_ROOT/project"

mkdir -p "$PROJECT"
cd "$PROJECT"

npm init -y >/dev/null
npm install --ignore-scripts --no-audit --no-fund "$TARBALL" >/dev/null

BIN="$PROJECT/node_modules/.bin/balade"

"$BIN" --version | grep -q "$PACKAGE_VERSION"
"$BIN" --help | grep -qi "walkthrough"
"$BIN" generate --help | grep -qi "provider"
"$BIN" generate --help | grep -Fqi "bare pull request number"
"$BIN" open --help | grep -Fqi "bare PR number"
"$BIN" generate --help | grep -qi "verbose"
"$BIN" generate --help | grep -qi -- "--trust-head-instructions"
"$BIN" generate --help | grep -qi -- "--no-open"
"$BIN" generate --help | grep -qi -- "--no-browser"
"$BIN" generate --help | grep -qi -- "--port"
if "$BIN" generate --help | grep -qi "choose-model"; then
  echo "obsolete --choose-model flag is still exposed" >&2
  exit 1
fi

# The tarball must carry both app bundles; open and build depend on them.
test -f "$PROJECT/node_modules/balade/dist/app/index.html"
test -f "$PROJECT/node_modules/balade/dist/export/app.js"

# The tarball also ships the rendered skill for path-based installers.
test -f "$PROJECT/node_modules/balade/dist/skill/balade-authoring/SKILL.md"
grep -q "^balade-authoring: " "$PROJECT/node_modules/balade/dist/skill/balade-authoring/SKILL.md"

"$BIN" skills --help | grep -qi "authoring"
"$BIN" skills install --help | grep -qi -- "--out"

# Zero-arg check outside a git repository reports and exits 0.
"$BIN" check | grep -qi "nothing to check"

# A real install writes the shared convention; .claude/ only once it exists.
SKILL_REPO="$TMP_ROOT/skill-repo"
mkdir -p "$SKILL_REPO"
git -C "$SKILL_REPO" init -q
(cd "$SKILL_REPO" && "$BIN" skills install >/dev/null)
test -f "$SKILL_REPO/.agents/skills/balade-authoring/SKILL.md"
test ! -e "$SKILL_REPO/.claude"
mkdir "$SKILL_REPO/.claude"
(cd "$SKILL_REPO" && "$BIN" skills install >/dev/null)
test -f "$SKILL_REPO/.claude/skills/balade-authoring/SKILL.md"

echo "npm package smoke passed: $TARBALL"
