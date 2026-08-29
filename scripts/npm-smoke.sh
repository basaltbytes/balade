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
GENERATE_HELP="$("$BIN" generate --help)"
OPEN_HELP="$("$BIN" open --help)"

# Interactive zsh strips unquoted #number; help leads with bare numbers and quotes the hash form.
grep -Fqi "Bare pull request number, URL, or quoted '#number'" <<<"$GENERATE_HELP"
grep -Fqi "bare PR number, URL, or quoted '#number'" <<<"$OPEN_HELP"
if grep -Fqi "URL, #number" <<<"$GENERATE_HELP$OPEN_HELP"; then
  echo "help still advertises shell-unsafe unquoted #number" >&2
  exit 1
fi

grep -qi "provider" <<<"$GENERATE_HELP"
grep -qi "verbose" <<<"$GENERATE_HELP"
grep -qi -- "--trust-head-instructions" <<<"$GENERATE_HELP"
grep -qi -- "--no-open" <<<"$GENERATE_HELP"
grep -qi -- "--no-browser" <<<"$GENERATE_HELP"
grep -qi -- "--port" <<<"$GENERATE_HELP"
if grep -qi "choose-model" <<<"$GENERATE_HELP"; then
  echo "obsolete --choose-model flag is still exposed" >&2
  exit 1
fi

# The tarball must carry both app bundles; open and build depend on them.
test -f "$PROJECT/node_modules/balade/dist/app/index.html"
test -f "$PROJECT/node_modules/balade/dist/export/app.js"

# The tarball also ships the rendered skill for path-based installers.
test -f "$PROJECT/node_modules/balade/dist/skill/balade-authoring/SKILL.md"
grep -q "^balade-authoring: " "$PROJECT/node_modules/balade/dist/skill/balade-authoring/SKILL.md"

# Generation announces the installed CLI and authoring identities before resolution starts.
AUTHORING_VERSION="$(sed -n 's/^balade-authoring: //p' "$PROJECT/node_modules/balade/dist/skill/balade-authoring/SKILL.md")"
GENERATE_STDOUT="$TMP_ROOT/generate.stdout"
GENERATE_STDERR="$TMP_ROOT/generate.stderr"
if "$BIN" generate 1 >"$GENERATE_STDOUT" 2>"$GENERATE_STDERR"; then
  echo "generate unexpectedly succeeded outside a git repository" >&2
  exit 1
fi
EXPECTED_BANNER="balade $PACKAGE_VERSION (authoring package $AUTHORING_VERSION)"
if [[ "$(<"$GENERATE_STDOUT")" != "$EXPECTED_BANNER" ]]; then
  echo "generate did not print its version banner first" >&2
  exit 1
fi
grep -Fqi "Not inside a git repository" "$GENERATE_STDERR"

"$BIN" skills --help | grep -qi "authoring"
"$BIN" skills install --help | grep -qi -- "--out"
"$BIN" agent --help | grep -qi "provider"
"$BIN" agent setup --help | grep -qi -- "--provider"
"$BIN" agent logout --help | grep -qi "stored"

# Zero-arg check outside a git repository reports and exits 0.
"$BIN" check | grep -qi "nothing to check"

# The package is also a library: the three calls type-check and run from a
# consumer project, rejections are the tagged errors with a sentence attached,
# and a finished call leaves nothing keeping the process alive.
cat >"$PROJECT/consumer.ts" <<'EOF_CONSUMER'
import { build, check, generate, type GenerateResult } from "balade";

export async function walkthrough(pullRequest: number): Promise<GenerateResult> {
  const result = await generate({
    pullRequest,
    model: { providerId: "openai-codex", modelId: "gpt-5.4" },
    headInstructions: "omit-changed",
    onProgress: (event) => console.log(event._tag),
  });
  await check(result.file);
  await build(result.file, { out: "review.html" });
  return result;
}
EOF_CONSUMER
cat >"$PROJECT/tsconfig.json" <<'EOF_TSCONFIG'
{
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "target": "es2023",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": []
  },
  "files": ["consumer.ts"]
}
EOF_TSCONFIG
"$ROOT/node_modules/.bin/tsc" -p "$PROJECT/tsconfig.json"
cat >"$PROJECT/consumer.mjs" <<'EOF_RUNTIME'
import { build, check, generate } from "balade";

const rejection = (promise) => promise.then(() => null, (error) => error);
const invalid = await rejection(generate({ pullRequest: "not-a-pull-request" }));
if (invalid?._tag !== "PullTargetInvalid" || !invalid.message.includes("pull request")) {
  throw new Error(`generate did not reject typed: ${String(invalid)}`);
}
const report = await check("missing.md");
if (report.ok !== false || report.diagnostics.length === 0) {
  throw new Error("check did not report the missing file");
}
const unreadable = await rejection(build("missing.md", { out: "missing.html" }));
if (unreadable?._tag !== "WalkthroughFileReadFailed" || !unreadable.message.includes("could not read")) {
  throw new Error(`build did not reject typed: ${String(unreadable)}`);
}
setTimeout(() => {
  console.error("the library left a handle open after its calls settled");
  process.exit(1);
}, 15_000).unref();
console.log("library smoke passed");
EOF_RUNTIME
node "$PROJECT/consumer.mjs" | grep -q "library smoke passed"

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
