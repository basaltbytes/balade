/**
 * The dependency law of src/ (DECISIONS.md, "The src/ layout"): one-directional
 * imports over autonomous concept modules, verbs only at the commands/
 * boundary. This walks the real import graph so a violating edge fails here
 * before it becomes load-bearing.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@effect/vitest";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

/** Repo-relative module paths of every src file, POSIX-spelled. */
function sourceFiles(directory: string = SRC): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) files.push(...sourceFiles(absolute));
    else if (entry.endsWith(".ts")) files.push(relative(SRC, absolute).replaceAll(sep, "/"));
  }
  return files.sort();
}

const IMPORT = /(?:from\s+|import\s*\(\s*|^\s*import\s+)["'](\.\.?\/[^"'\n]+)["']/gm;

/** The src-relative modules a file imports, resolved from its own directory. */
function importsOf(file: string): string[] {
  const source = readFileSync(join(SRC, file), "utf8");
  const found: string[] = [];
  for (const match of source.matchAll(IMPORT)) {
    const specifier = match[1] ?? "";
    const resolved = posix.normalize(posix.join(posix.dirname(file), specifier));
    found.push(resolved.replace(/\.js$/, ".ts"));
  }
  return found;
}

/** The layer a module belongs to: a concept folder, `commands/<verb>`, or its root file. */
function layerOf(module: string): string {
  const [head, verb] = module.split("/");
  if (head === "commands") return `commands/${verb}`;
  return module.includes("/") ? (head ?? module) : module;
}

const ROOT_UTILS = ["shell.ts", "state.ts", "terminal.ts", "failure.ts"];

/** Which layers each layer may import from. Orchestrators may import anything but commands/. */
const CONCEPT_EDGES: Record<string, readonly string[]> = {
  contract: ["contract"],
  preset: ["preset", "contract"],
  authoring: ["authoring"],
  git: ["git", "contract", ...ROOT_UTILS],
  walkthrough: ["walkthrough", "preset", "contract", ...ROOT_UTILS],
  pi: ["pi", "authoring", "git", "contract", ...ROOT_UTILS],
  ...Object.fromEntries(ROOT_UTILS.map((util) => [util, [util, "contract"]])),
};

describe("the src/ dependency law", () => {
  const files = sourceFiles();
  const edges = files.flatMap((file) => importsOf(file).map((target) => ({ file, target })));

  it("finds the modules it polices", () => {
    expect(files).toContain("cli.ts");
    expect(files).toContain("walkthrough/pipeline.ts");
    expect(edges.length).toBeGreaterThan(50);
  });

  it("resolves every relative import to a real src module", () => {
    const known = new Set(files);
    const dead = edges.filter((edge) => !known.has(edge.target));
    expect(dead).toEqual([]);
  });

  it("keeps concepts and root utils on their allowed imports", () => {
    const violations = edges.filter(({ file, target }) => {
      const allowed = CONCEPT_EDGES[layerOf(file)];
      if (allowed === undefined) return false; // cli.ts, commands/, server/ compose freely
      return !allowed.includes(layerOf(target));
    });
    expect(violations).toEqual([]);
  });

  it("keeps the command boundary private to cli.ts and its own verb", () => {
    const violations = edges.filter(({ file, target }) => {
      if (!target.startsWith("commands/")) return false;
      return file !== "cli.ts" && layerOf(file) !== layerOf(target);
    });
    expect(violations).toEqual([]);
  });

  it("mounts verbs only at the boundary", () => {
    const misplaced = files.filter((file) => {
      if (file === "cli.ts") return false;
      const definesCommand = /\bCommand\.make\(/.test(readFileSync(join(SRC, file), "utf8"));
      return definesCommand && !/^commands\/[^/]+\/index\.ts$/.test(file);
    });
    expect(misplaced).toEqual([]);
  });
});
