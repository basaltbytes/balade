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

# The tarball must carry both app bundles; open and build depend on them.
test -f "$PROJECT/node_modules/balade/dist/app/index.html"
test -f "$PROJECT/node_modules/balade/dist/export/app.js"

# Zero-arg check outside a git repository reports and exits 0.
"$BIN" check | grep -qi "nothing to check"

echo "npm package smoke passed: $TARBALL"
