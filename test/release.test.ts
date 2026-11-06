/**
 * The release scripts against a registry they can reach: a local HTTP server
 * standing in for npm and GitHub, and the pnpm that runs this test publishing a workspace.
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

describe("release publishing", () => {
  it("publishes the unpublished workspace versions, the root included, and skips public ones", async () => {
    const directory = await mkdtemp(join(tmpdir(), "balade-publish-test-"));
    try {
      const root = { name: "publish-test-root", version: "1.0.1" };
      const packages = [
        { name: "@publish-test/changed", version: "1.0.1" },
        { name: "@publish-test/unchanged", version: "1.0.0" },
        { name: "@publish-test/private", version: "1.0.0", private: true },
      ];
      await writeFile(join(directory, "package.json"), JSON.stringify(root));
      await writeFile(join(directory, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
      for (const pkg of packages) {
        const path = join(directory, "packages", basename(pkg.name));
        await mkdir(path, { recursive: true });
        await writeFile(join(path, "package.json"), JSON.stringify(pkg));
      }
      // Version 1.0.0 of every package is public; 1.0.1 is not until it is published.
      const published: string[] = [];
      const url = await listen(
        createServer(async (request, response) => {
          const path = decodeURIComponent(request.url ?? "");
          response.setHeader("content-type", "application/json");
          if (request.method === "GET") {
            const { name, version } = parsePath(path);
            if (version !== undefined) {
              const served = version === "1.0.0" || published.includes(`/${name} ${version}`);
              response.writeHead(served ? 200 : 404);
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
          // `pnpm publish` PUTs the packument with the new version.
          const versions = Object.keys(JSON.parse(await body(request)).versions);
          published.push(`${path} ${versions.join(",")}`);
          response.end(JSON.stringify({ ok: true }));
        }),
      );
      const port = new URL(url).port;
      await writeFile(
        join(directory, ".npmrc"),
        `registry=${url}\nfetch-retries=0\n//127.0.0.1:${port}/:_authToken=fixture-token\n`,
      );
      const script = fileURLToPath(new URL("../scripts/release/publish.mjs", import.meta.url));
      const { stdout } = await exec(process.execPath, [script], {
        cwd: directory,
        env: { ...process.env, CI: "true" },
        timeout: 60_000,
      });
      expect(published.sort()).toEqual([
        "/@publish-test/changed 1.0.1",
        "/publish-test-root 1.0.1",
      ]);
      expect(stdout).toContain("@publish-test/unchanged@1.0.0 is on the registry");
      expect(stdout).toContain('"release_published"');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("release tagging", () => {
  it("tags the commit that set the version, creates the GitHub Release, and does each once", async () => {
    const directory = await mkdtemp(join(tmpdir(), "balade-tag-test-"));
    try {
      const origin = join(directory, "origin.git");
      const work = join(directory, "work");
      const identity = {
        GIT_AUTHOR_NAME: "fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.com",
        GIT_COMMITTER_NAME: "fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.com",
      };
      const git = async (...args: string[]) =>
        (
          await exec("git", args, { cwd: work, env: { ...process.env, ...identity } })
        ).stdout.trim();
      await exec("git", ["init", "--bare", "--initial-branch=main", origin]);
      await mkdir(join(work, "packages", "lib"), { recursive: true });
      await git("init", "--initial-branch=main");
      await git("remote", "add", "origin", origin);
      await writeFile(join(work, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
      const manifest = (name: string) => JSON.stringify({ name, version: "1.0.0" }, null, 2);
      await writeFile(join(work, "packages", "lib", "package.json"), manifest("@tag-test/lib"));
      await writeFile(join(work, "package.json"), manifest("tag-test-root"));
      await git("add", ".");
      await git("commit", "-q", "-m", "Version Packages");
      const versioned = await git("rev-parse", "HEAD");
      // main moves on while the maintainer approves.
      await writeFile(join(work, "README.md"), "later\n");
      await git("add", ".");
      await git("commit", "-q", "-m", "later commit");
      await git("push", "-q", "-u", "origin", "main");

      // One server is both the registry and the GitHub API.
      let approved = false;
      const releases: Array<{ authorization: string | undefined; body: string }> = [];
      const url = await listen(
        createServer(async (request, response) => {
          const path = decodeURIComponent(request.url ?? "");
          response.setHeader("content-type", "application/json");
          if (path === "/repos/acme/tag-test/releases/tags/v1.0.0") {
            response.writeHead(releases.length > 0 ? 200 : 404);
            response.end("{}");
            return;
          }
          if (path === "/repos/acme/tag-test/releases" && request.method === "POST") {
            releases.push({
              authorization: request.headers.authorization,
              body: await body(request),
            });
            response.writeHead(201);
            response.end("{}");
            return;
          }
          const { name, version } = parsePath(path);
          response.writeHead(approved ? 200 : 404);
          response.end(JSON.stringify({ name, version }));
        }),
      );
      await writeFile(join(work, ".npmrc"), `registry=${url}\nfetch-retries=0\n`);
      const script = fileURLToPath(new URL("../scripts/release/tag.mjs", import.meta.url));
      const tag = () =>
        exec(process.execPath, [script], {
          cwd: work,
          env: {
            ...process.env,
            ...identity,
            CI: "true",
            GITHUB_TOKEN: "fixture-token",
            GITHUB_REPOSITORY: "acme/tag-test",
            GITHUB_API_URL: url.replace(/\/$/, ""),
          },
          timeout: 60_000,
        });
      const originTags = async () =>
        (await exec("git", ["ls-remote", "--tags", origin])).stdout.trim();

      const pending = await tag();
      expect(pending.stdout).toContain('"release_unpublished"');
      expect(pending.stdout).toContain("@tag-test/lib@1.0.0");
      expect(await originTags()).toBe("");
      expect(releases).toEqual([]);

      approved = true;
      const tagged = await tag();
      expect(tagged.stdout).toContain(`Pushed v1.0.0 at ${versioned}.`);
      expect(await originTags()).toBe(`${versioned}\trefs/tags/v1.0.0`);
      expect(releases).toEqual([
        {
          authorization: "Bearer fixture-token",
          body: JSON.stringify({
            tag_name: "v1.0.0",
            name: "v1.0.0",
            generate_release_notes: true,
          }),
        },
      ]);

      const again = await tag();
      expect(again.stdout).toContain("v1.0.0 is already on origin.");
      expect(again.stdout).toContain("GitHub Release v1.0.0 already exists.");
      expect(releases).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
