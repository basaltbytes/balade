/**
 * `build`: the one file it writes, what it bakes into it, and the escapes that
 * keep a walkthrough about HTML from ending its own payload early.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest";
import { runBuild as runBuildEffect, type BuildOptions } from "../src/build/run.js";
import type { Payload } from "../src/payload/types.js";
import { provideLive } from "./support/effect.js";
import { createFixtureRepo, type FixtureRepo } from "./support/repo.js";

const runBuild = (options: BuildOptions) => provideLive(runBuildEffect(options));

/**
 * A stand-in for the export bundle. The real one carries these three sequences
 * inside grammar data — `<!--` followed by `<script>` is what makes an HTML
 * parser stop honouring the closing tag.
 */
const STUB_JS = `const marks = { end: "</script>", comment: "<!--", open: "<script>" };
window.__BALADE_STUB__ = marks;
`;

function stubBundle(): string {
  const dir = mkdtempSync(join(tmpdir(), "balade-export-"));
  writeFileSync(join(dir, "app.js"), STUB_JS, "utf8");
  writeFileSync(join(dir, "app.css"), "#root{color:#fff}\n", "utf8");
  return dir;
}

const BAKE = "window.__BALADE__=";

/** Reads the payload back the way a browser does: up to the first `</script>`. */
function bakedPayload(html: string): Payload {
  const start = html.indexOf(BAKE);
  expect(start).toBeGreaterThan(-1);
  const from = start + BAKE.length;
  return JSON.parse(html.slice(from, html.indexOf("</script>", from))) as Payload;
}

describe("build", () => {
  let repo: FixtureRepo;
  let bundleDir: string;

  beforeAll(() => {
    repo = createFixtureRepo();
    repo.addWalkthrough("valid.md", "valid.md");
    bundleDir = stubBundle();
  });

  afterAll(() => {
    repo.cleanup();
    rmSync(bundleDir, { recursive: true, force: true });
  });

  const build = (paths: readonly string[], out?: string) =>
    runBuild({
      cwd: repo.dir,
      paths,
      useGh: false,
      bundleDir,
      ...(out !== undefined ? { out } : {}),
    });

  it.effect("writes one HTML file beside the walkthrough, with the payload baked in", () =>
    Effect.gen(function* () {
      const result = yield* build(["walkthroughs/valid.md"]);
      if (result.kind !== "built") throw new Error(`build refused: ${JSON.stringify(result)}`);

      expect(result.file).toBe(join(repo.dir, "walkthroughs/valid.html"));
      expect(readdirSync(join(repo.dir, "walkthroughs")).sort()).toEqual([
        "valid.html",
        "valid.md",
      ]);

      const html = readFileSync(result.file, "utf8");
      const payload = bakedPayload(html);
      expect(payload.walkthrough).toBe(1);
      expect(payload.title).toBe("Add live planning pool items");
      expect(payload.sourcePath).toBe("walkthroughs/valid.md");
      expect(payload.sections.map((section) => section.id)).toContain("overview");
      /* Review state falls back to localStorage under this key (#14). */
      expect(payload.storageKey).toContain("walkthroughs/valid.md");
    }),
  );

  it.effect("names no file but itself", () =>
    Effect.gen(function* () {
      const result = yield* build(["walkthroughs/valid.md"]);
      if (result.kind !== "built") throw new Error(`build refused: ${JSON.stringify(result)}`);
      const html = readFileSync(result.file, "utf8");

      for (const [, url] of html.matchAll(/(?:src|href)\s*=\s*"([^"]*)"/g)) {
        expect(url).toMatch(/^data:/);
      }
      expect(html).toContain("#root{color:#fff}");
      expect(html).toContain("window.__BALADE_STUB__");
      expect(html).toContain('<script type="module">');
    }),
  );

  it.effect("threads --lang through to the baked payload", () =>
    Effect.gen(function* () {
      const result = yield* runBuild({
        cwd: repo.dir,
        paths: ["walkthroughs/valid.md"],
        useGh: false,
        bundleDir,
        lang: "fr",
      });
      if (result.kind !== "built") throw new Error(`build refused: ${JSON.stringify(result)}`);
      /* The fixture frontmatter says `lang: en`; the flag wins. */
      expect(bakedPayload(readFileSync(result.file, "utf8")).lang).toBe("fr");
      expect(readFileSync(result.file, "utf8")).toContain('<html lang="fr">');
    }),
  );

  it.effect("writes where --out says", () =>
    Effect.gen(function* () {
      const out = join(repo.dir, "export/pool.html");
      const error = yield* Effect.flip(
        runBuild({
          cwd: repo.dir,
          paths: ["walkthroughs/valid.md"],
          out: "export/pool.html",
          useGh: false,
          bundleDir,
        }),
      );
      expect(error).toMatchObject({ _tag: "ExportWriteFailed", path: out });

      repo.write("export/.keep", "");
      const again = yield* build(["walkthroughs/valid.md"], "export/pool.html");
      if (again.kind !== "built") throw new Error(`build refused: ${JSON.stringify(again)}`);
      expect(again.file).toBe(out);
      expect(bakedPayload(readFileSync(out, "utf8")).title).toBe("Add live planning pool items");
    }),
  );

  it.effect("escapes what the prose and the bundle carry", () =>
    Effect.gen(function* () {
      repo.addWalkthrough("script-prose.md", "script-prose.md");
      const result = yield* build(["walkthroughs/script-prose.md"]);
      if (result.kind !== "built") throw new Error(`build refused: ${JSON.stringify(result)}`);
      const html = readFileSync(result.file, "utf8");

      /* The payload survives the round trip a browser makes through it. */
      expect(JSON.stringify(bakedPayload(html))).toContain("</script>");

      /* Two closing tags, and nothing else that ends or derails script data. */
      expect(html.match(/<\/script/g)).toHaveLength(2);
      expect(html).not.toContain("<!--");
      expect(html).toContain('"<\\/script>"');
      expect(html).toContain('"<\\!--"');
      /* The title is HTML text, not script data. */
      expect(html).toContain("<title>Close the &lt;/script&gt; hole</title>");
    }),
  );

  it.effect("stops with the discovered paths when no file is named", () =>
    Effect.gen(function* () {
      const result = yield* build([]);
      if (result.kind !== "note") throw new Error(`expected a note, got ${result.kind}`);
      expect(result.message).toContain("walkthroughs/valid.md");
      expect(result.message).toContain("walkthroughs/script-prose.md");
    }),
  );

  it.effect("exports one walkthrough at a time", () =>
    Effect.gen(function* () {
      const result = yield* build(["walkthroughs/valid.md", "walkthroughs/script-prose.md"]);
      expect(result).toMatchObject({ kind: "note" });
    }),
  );

  it.effect("says where the export bundle should be when it is missing", () =>
    Effect.gen(function* () {
      const dir = join(repo.dir, "nowhere");
      const error = yield* Effect.flip(
        runBuild({
          cwd: repo.dir,
          paths: ["walkthroughs/valid.md"],
          useGh: false,
          bundleDir: dir,
        }),
      );
      expect(error).toMatchObject({ _tag: "ExportBundleReadFailed", dir });
    }),
  );
});
