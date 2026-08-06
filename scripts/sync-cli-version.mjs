#!/usr/bin/env node
// `changeset version` bumps only package.json; the CLI hardcodes its own copy
// in src/cli.ts. The changesets workflow runs this right after versioning so
// the "Version Packages" PR carries both files in step, and
// test/version.test.ts fails the build whenever they drift apart.
import { readFileSync, writeFileSync } from "node:fs";

const packageUrl = new URL("../package.json", import.meta.url);
const cliUrl = new URL("../src/cli.ts", import.meta.url);

const { version } = JSON.parse(readFileSync(packageUrl, "utf8"));
const source = readFileSync(cliUrl, "utf8");
const constant = `const VERSION = "${version}";`;
const updated = source.replace(/^const VERSION = "[^"]*";$/m, constant);

if (!updated.includes(constant)) {
  console.error(`sync-cli-version: no VERSION constant found in src/cli.ts to set to ${version}`);
  process.exit(1);
}

writeFileSync(cliUrl, updated);
console.log(`sync-cli-version: src/cli.ts VERSION = "${version}"`);
