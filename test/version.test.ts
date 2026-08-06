import { readFileSync } from "node:fs";
import { describe, expect, it } from "@effect/vitest";

/**
 * The npm version lives in package.json; the CLI hardcodes its own copy in
 * src/cli.ts (scripts/sync-cli-version.mjs keeps them in step during
 * `changeset version`). Catch any drift at test time rather than at publish
 * time, where only the npm-smoke grep would notice.
 */
describe("release version", () => {
  it("keeps the src/cli.ts VERSION constant in step with package.json", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    const cliSource = readFileSync(new URL("../src/cli.ts", import.meta.url), "utf8");
    expect(cliSource).toContain(`const VERSION = "${packageJson.version}";`);
  });
});
