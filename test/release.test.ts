/**
 * The release scripts against a registry they can reach: a local HTTP server
 * standing in for npm, and the pnpm that runs this test staging a workspace.
 */
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { Predicate } from "effect";
import { unpublishedPackages } from "../scripts/release/registry.mjs";

const exec = promisify(execFile);
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise((done) => server.close(done));
});

async function listen(server: Server): Promise<string> {
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || Predicate.isString(address)) throw new Error("no port");
  return `http://127.0.0.1:${address.port}/`;
}

interface Pkg {
  readonly name: string;
  readonly version: string;
}

describe("release registry check", () => {
  const first: Pkg = { name: "@balade/first", version: "1.0.0" };
  const second: Pkg = { name: "@balade/second", version: "2.0.0" };

  async function registry() {
    const replies = new Map<string, { status: number; body: string }>();
    const url = await listen(
      createServer((request, response) => {
        const reply = replies.get(decodeURIComponent(request.url ?? ""));
        response.writeHead(reply?.status ?? 404, { "content-type": "application/json" });
        response.end(reply?.body ?? JSON.stringify({ error: "Not found" }));
      }),
    );
    const reply = (pkg: Pkg, status: number, body: Pkg = pkg) =>
      replies.set(`/${pkg.name}/${pkg.version}`, { status, body: JSON.stringify(body) });
    return { url, reply, replies };
  }

  it("keeps every unavailable version pending, including partial approvals", async () => {
    const { url, reply } = await registry();
    expect(await unpublishedPackages([first, second], url)).toEqual([
      "@balade/first@1.0.0",
      "@balade/second@2.0.0",
    ]);
    reply(first, 200);
    expect(await unpublishedPackages([first, second], url)).toEqual(["@balade/second@2.0.0"]);
    reply(second, 200);
    expect(await unpublishedPackages([first, second], url)).toEqual([]);
  });

  it("fails closed on registry errors and mismatched metadata", async () => {
    const { url, reply, replies } = await registry();
    reply(second, 503);
    await expect(unpublishedPackages([second], url)).rejects.toThrow(/HTTP 503/);
    reply(second, 200, { ...second, version: "1.0.0" });
    await expect(unpublishedPackages([second], url)).rejects.toThrow(/unexpected metadata/);
    replies.set(`/${second.name}/${second.version}`, { status: 200, body: "not json" });
    await expect(unpublishedPackages([second], url)).rejects.toThrow(SyntaxError);
  });
});

/** `/name/version` or `/@scope/name/version` asks for one version; a bare name asks for the packument. */
function parsePath(path: string) {
  const segments = path.slice(1).split("/");
  const nameLength = segments[0]?.startsWith("@") ? 2 : 1;
  return { name: segments.slice(0, nameLength).join("/"), version: segments[nameLength] };
}

async function body(request: IncomingMessage): Promise<string> {
  let text = "";
  for await (const chunk of request) text += chunk;
  return text;
}

describe("release staging", () => {
  it("stages the unpublished workspace versions, the root included, and skips public ones", async () => {
    const directory = await mkdtemp(join(tmpdir(), "balade-stage-test-"));
    try {
      const root = { name: "stage-test-root", version: "1.0.1" };
      const packages = [
        { name: "@stage-test/changed", version: "1.0.1" },
        { name: "@stage-test/unchanged", version: "1.0.0" },
        { name: "@stage-test/private", version: "1.0.0", private: true },
      ];
      await writeFile(join(directory, "package.json"), JSON.stringify(root));
      await writeFile(join(directory, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
      for (const pkg of packages) {
        const path = join(directory, "packages", basename(pkg.name));
        await mkdir(path, { recursive: true });
        await writeFile(join(path, "package.json"), JSON.stringify(pkg));
      }
      // Version 1.0.0 of every package is public; 1.0.1 is not.
      const staged: string[] = [];
      const url = await listen(
        createServer(async (request, response) => {
          const path = decodeURIComponent(request.url ?? "");
          response.setHeader("content-type", "application/json");
          if (request.method === "GET") {
            const { name, version } = parsePath(path);
            if (version !== undefined) {
              response.writeHead(version === "1.0.0" ? 200 : 404);
              response.end(JSON.stringify({ name, version }));
              return;
            }
            const dist = { tarball: `${url}unused.tgz` };
            response.end(
              JSON.stringify({
                name,
                "dist-tags": { latest: "1.0.0" },
                versions: { "1.0.0": { name, version: "1.0.0", dist } },
              }),
            );
            return;
          }
          const versions = Object.keys(JSON.parse(await body(request)).versions);
          staged.push(`${path} ${versions.join(",")}`);
          response.end(JSON.stringify({ stageId: "123e4567-e89b-12d3-a456-426614174000" }));
        }),
      );
      const port = new URL(url).port;
      await writeFile(
        join(directory, ".npmrc"),
        `registry=${url}\nfetch-retries=0\n//127.0.0.1:${port}/:_authToken=fixture-token\n`,
      );
      const script = fileURLToPath(new URL("../scripts/release/stage.mjs", import.meta.url));
      const { stdout } = await exec(process.execPath, [script], {
        cwd: directory,
        env: { ...process.env, CI: "true" },
        timeout: 60_000,
      });
      expect(staged.sort()).toEqual([
        "/-/stage/package/@stage-test/changed 1.0.1",
        "/-/stage/package/stage-test-root 1.0.1",
      ]);
      expect(stdout).toContain("@stage-test/unchanged@1.0.0 is on the registry");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
