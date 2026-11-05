/** Exercise the packed @balade/core contract as browser code and the installed explicit-range CLI. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";

const [project, gitBinary] = process.argv.slice(2);
assert.ok(project && gitBinary, "usage: contract-smoke.mjs <installed project> <git binary>");
const entry = join(project, "browser-contract.mjs");
writeFileSync(entry, 'export { decodePayload, PAYLOAD_FORMAT } from "@balade/core";\n');
await build({
  configFile: false,
  root: project,
  logLevel: "error",
  plugins: [
    {
      name: "reject-node-builtins",
      resolveId(id) {
        assert.equal(isBuiltin(id), false, `browser contract imported ${id}`);
      },
    },
  ],
  build: {
    outDir: "browser-dist",
    lib: { entry, formats: ["es"], fileName: () => "contract.mjs" },
  },
});
const { decodePayload, PAYLOAD_FORMAT } = await import(
  pathToFileURL(join(project, "browser-dist/contract.mjs"))
);
// Import Effect from the installed consumer, the same version the contract uses.
const { Effect } = await import(pathToFileURL(join(project, "node_modules/effect/dist/index.js")));
const { compilePayload } = await import(
  pathToFileURL(join(project, "node_modules/balade/dist/library.js"))
);

const repo = join(project, "repo");
mkdirSync(repo);
const git = (...args) => execFileSync(gitBinary, args, { cwd: repo, encoding: "utf8" }).trim();
git("init", "-q", "-b", "release/2");
git("config", "user.name", "Fixture");
git("config", "user.email", "fixture@example.test");
writeFileSync(join(repo, "feature.ts"), "export const answer = 41;\n");
git("add", ".");
git("-c", "core.hooksPath=/dev/null", "commit", "-q", "--no-gpg-sign", "-m", "base");
const base = git("rev-parse", "HEAD");
writeFileSync(join(repo, "feature.ts"), "export const answer = 42;\n");
git("add", ".");
git("-c", "core.hooksPath=/dev/null", "commit", "-q", "--no-gpg-sign", "-m", "head");
const head = git("rev-parse", "HEAD");
writeFileSync(
  join(repo, "review.md"),
  `---
walkthrough: 1
pr: 42
commit: ${head}
title: Correct the answer
---
{% group label="The answer" %}
{% section id="overview" title="Correct the answer" %}
The answer is now 42.
{% code file="feature.ts" from=1 to=1 expect="export const answer = 42;" /%}
{% /section %}
{% /group %}
{% group label="Full diff" %}
{% section id="files" title="Changed files" %}
{% files /%}
{% /section %}
{% /group %}
`,
);

// Child processes can find Git, but no gh (nor a default branch or origin/HEAD).
const gitOnly = join(project, "git-only");
mkdirSync(gitOnly);
symlinkSync(gitBinary, join(gitOnly, "git"));
const bin = join(project, "node_modules/balade/dist/cli.js");
const run = (...args) =>
  spawnSync(process.execPath, [bin, ...args], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, PATH: gitOnly },
  });
const flags = ["--base", base, "--head", head];
const checked = run("check", "review.md", "--json", ...flags);
assert.equal(checked.status, 0, checked.stderr + checked.stdout);
const exported = run("build", "review.md", "--format", "json", ...flags, "--out", "payload.json");
assert.equal(exported.status, 0, exported.stderr + exported.stdout);
const payload = await Effect.runPromise(
  decodePayload(JSON.parse(readFileSync(join(repo, "payload.json"), "utf8"))),
);
assert.equal(payload.format, PAYLOAD_FORMAT);
const htmlExport = run("build", "review.md", ...flags, "--out", "review.html");
assert.equal(htmlExport.status, 0, htmlExport.stderr + htmlExport.stdout);
const html = readFileSync(join(repo, "review.html"), "utf8");
const baked = html.split("window.__BALADE__=")[1]?.split("</script>")[0];
assert.ok(baked);
assert.deepEqual(JSON.parse(baked), payload);

// Import in a separate process so the live process adapter captures the restricted PATH.
writeFileSync(
  join(project, "compile.mjs"),
  `
import { compilePayload } from "balade";
console.log(JSON.stringify(await compilePayload(JSON.parse(process.argv[2]))));
`,
);
const options = { repository: repo, file: "review.md", base, head };
const compiled = JSON.parse(
  execFileSync(process.execPath, [join(project, "compile.mjs"), JSON.stringify(options)], {
    env: { ...process.env, PATH: gitOnly },
    encoding: "utf8",
  }),
);
assert.equal(compiled._tag, "Compiled");
assert.deepEqual(compiled.payload, payload);
assert.deepEqual(compiled.report, JSON.parse(checked.stdout).reports[0]);
await assert.rejects(compilePayload({ ...options, file: "missing.md" }), {
  _tag: "WalkthroughFileReadFailed",
});
for (const verb of ["check", "build"]) {
  for (const flag of ["--base", "--head"]) {
    const incomplete = run(verb, "review.md", flag, head);
    assert.notEqual(incomplete.status, 0);
    assert.match(incomplete.stderr, /--base and --head must be supplied together/);
  }
}
console.log("browser contract and explicit-range package smoke passed");
