/**
 * Ship only the declarations a consumer can reach from the public entry.
 *
 * TypeScript emits one file per module in the program, internal state and
 * decoders included. The contract types resolve to `@balade/core`, so the
 * viewer never repeats the schema declarations, and NodeNext consumers get
 * the explicit extensions Vite does not require in source.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const emitted = join(here, "dist/declarations/app/src");
const output = join(here, "dist/types");
const entry = join(emitted, "viewer.d.ts");
const replaced = new Map([
  [join(emitted, "contract.d.ts"), 'export type * from "@balade/core";\n'],
]);
const specifier = /(from\s+|import\()(["'])(\.{1,2}\/[^"']+)(["'])/g;

const reachable = new Map();
async function visit(file) {
  if (reachable.has(file)) return;
  const inside = relative(emitted, file);
  if (inside.startsWith("..") || isAbsolute(inside)) {
    throw new Error(`viewer declarations reach outside app/src: ${relative(here, file)}`);
  }
  const declaration = replaced.get(file) ?? (await readFile(file, "utf8"));
  reachable.set(file, declaration);
  for (const [, , , path] of declaration.matchAll(specifier)) {
    const base = resolve(dirname(file), path).replace(/\.js$/, "");
    const target = [`${base}.d.ts`, `${base}/index.d.ts`].find((candidate) =>
      existsSync(candidate),
    );
    if (target === undefined) throw new Error(`unresolved ${path} in ${relative(here, file)}`);
    await visit(target);
  }
}
await visit(entry);

await rm(output, { recursive: true, force: true });
for (const [file, declaration] of reachable) {
  const target = join(output, relative(emitted, file));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(
    target,
    declaration.replace(specifier, (match, prefix, quote, path, closing) =>
      path.endsWith(".js") ? match : `${prefix}${quote}${path}.js${closing}`,
    ),
  );
}
await rm(join(here, "dist/declarations"), { recursive: true });
