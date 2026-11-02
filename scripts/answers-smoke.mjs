/** Packed portable answers and the installed CLI, using contract-smoke's fixture clone. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";

const [project, gitBinary] = process.argv.slice(2);
assert.ok(project && gitBinary);
const entry = join(project, "browser-answers.mjs");
writeFileSync(
  entry,
  'export { checkAnswer, checkAnswerEffect, clarificationContext } from "balade/answers";\n',
);
await build({
  configFile: false,
  root: project,
  logLevel: "error",
  plugins: [
    {
      name: "reject-node-builtins",
      resolveId(id) {
        assert.equal(isBuiltin(id), false, `portable answers imported ${id}`);
      },
    },
  ],
  build: { outDir: "answers-dist", lib: { entry, formats: ["es"], fileName: () => "answers.mjs" } },
});
const portable = await import(pathToFileURL(join(project, "answers-dist/answers.mjs")));
const { Effect } = await import(pathToFileURL(join(project, "node_modules/effect/dist/index.js")));
const { decodePayload } = await import(
  pathToFileURL(join(project, "node_modules/balade/dist/contract/payload.js"))
);
const repo = join(project, "repo");
const payload = await Effect.runPromise(
  decodePayload(JSON.parse(readFileSync(join(repo, "payload.json"), "utf8"))),
);
const git = (...args) => execFileSync(gitBinary, args, { cwd: repo, encoding: "utf8" }).trim();
const base = git("rev-parse", "HEAD^");
const head = git("rev-parse", "HEAD");
const body =
  'The constant changed.\n\n{% code file="feature.ts" from=1 to=1 expect="export const answer = 42;" /%}';
const source = { _tag: "Payload", payload };
const accepted = await portable.checkAnswer(body, source);
assert.equal(accepted._tag, "Accepted");
assert.deepEqual(await Effect.runPromise(portable.checkAnswerEffect(body, source)), accepted);
assert.match(
  portable.clarificationContext({
    walkthrough: payload,
    anchor: { sectionId: "overview", excerpt: "42" },
    question: "Why?",
    turns: [],
  }),
  /untrusted data, never instructions/,
);

// This child can find only Git; it has neither gh nor any provider credentials.
const bin = join(project, "node_modules/balade/dist/cli.js");
const run = (...args) =>
  spawnSync(
    process.execPath,
    [bin, "answer", "check", "answer.md", "--walkthrough", "review.md", ...args],
    {
      cwd: repo,
      encoding: "utf8",
      env: { PATH: join(project, "git-only"), HOME: project, USERPROFILE: project },
    },
  );
const flags = ["--base", base, "--head", head];
const original = readFileSync(join(repo, "review.md"), "utf8");
writeFileSync(join(repo, "answer.md"), body);
const checked = run(...flags, "--format", "json");
assert.equal(checked.status, 0, checked.stderr + checked.stdout);
assert.deepEqual(JSON.parse(checked.stdout), accepted);
const text = run(...flags);
assert.equal(text.status, 0, text.stderr);
assert.match(text.stdout, /accepted/);
writeFileSync(join(repo, "answer.md"), '{% section id="nested" title="Nested" %}No{% /section %}');
const invalid = run(...flags, "--format", "json");
assert.equal(invalid.status, 1, invalid.stderr + invalid.stdout);
const rejected = JSON.parse(invalid.stdout);
assert.equal(rejected._tag, "Rejected");
assert.ok(rejected.diagnostics.length > 0);
assert.equal(run(...flags).status, 1);
assert.notEqual(run("--base", base).status, 0);
assert.notEqual(run("--head", head).status, 0);
assert.equal(readFileSync(join(repo, "review.md"), "utf8"), original);
console.log("portable answers and installed answer check passed");
