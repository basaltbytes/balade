#!/usr/bin/env node
// `changeset version` bumps only package.json; the CLI hardcodes its own copy
// in src/version.ts. The changesets workflow runs this right after versioning so
// the "Version Packages" PR carries both files in step, and
// test/version.test.ts fails the build whenever they drift apart.
import { readFileSync, writeFileSync } from "node:fs";

const packageUrl = new URL("../package.json", import.meta.url);
const versionUrl = new URL("../src/version.ts", import.meta.url);

const { version } = JSON.parse(readFileSync(packageUrl, "utf8"));
const source = readFileSync(versionUrl, "utf8");
const constant = `export const VERSION = "${version}";`;
const updated = source.replace(/^export const VERSION = "[^"]*";$/m, constant);

if (!updated.includes(constant)) {
  console.error(
    `sync-cli-version: no VERSION constant found in src/version.ts to set to ${version}`,
  );
  process.exit(1);
}

writeFileSync(versionUrl, updated);
console.log(`sync-cli-version: src/version.ts VERSION = "${version}"`);
