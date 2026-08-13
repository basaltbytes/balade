#!/usr/bin/env node
// tsc emits only JavaScript; the authoring prose ships as Markdown files that
// `proseTemplate` resolves beside each compiled module. The build therefore
// mirrors every src/**/*.md into dist/ at the same relative path.
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sourceRoot = join(root, "src");
const distRoot = join(root, "dist");

const prose = readdirSync(sourceRoot, { recursive: true, encoding: "utf8" }).filter((file) =>
  file.endsWith(".md"),
);
for (const file of prose) {
  const target = join(distRoot, file);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(sourceRoot, file), target);
}
console.log(`copied ${prose.length} prose file(s) into dist/`);
