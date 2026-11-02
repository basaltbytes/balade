/** NodeNext consumers need extensions even though Vite accepts extensionless source imports. */
import { readdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../dist/viewer/types/", import.meta.url);
for (const path of await readdir(root, { recursive: true })) {
  if (!path.endsWith(".d.ts")) continue;
  const file = new URL(path.replaceAll("\\", "/"), root);
  const declaration = await readFile(file, "utf8");
  await writeFile(
    file,
    declaration.replace(
      /(from\s+|import\()(["'])(\.{1,2}\/[^"']+)(["'])/g,
      (match, prefix, quote, specifier, closing) =>
        specifier.endsWith(".js") ? match : `${prefix}${quote}${specifier}.js${closing}`,
    ),
  );
}
