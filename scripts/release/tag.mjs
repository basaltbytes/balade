/**
 * Once npm serves every workspace version, tag the release and create its
 * GitHub Release.
 *
 * The three packages share one version, so the release is one `v<version>`
 * tag. It goes on the commit that set that version in `package.json`, not on
 * HEAD, so a re-run at a later `main` still tags the right commit. A tag or a
 * release that already exists is left alone, so re-running the job is safe.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { members, registry } from "./pnpm.mjs";
import { unpublishedPackages } from "./registry.mjs";

// The action reads this report even when no tag was created.
if (process.env.CHANGESETS_OUTPUT) appendFileSync(process.env.CHANGESETS_OUTPUT, "");

const git = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const timeout = () => AbortSignal.timeout(30_000);

/** Pushes `tag` at `commit` unless origin already has it. */
function pushTag(tag, commit) {
  if (git(["ls-remote", "--tags", "origin", `refs/tags/${tag}`]) !== "") {
    console.log(`${tag} is already on origin.`);
    return;
  }
  git(["tag", tag, commit]);
  git(["push", "origin", `refs/tags/${tag}`]);
  console.log(`Pushed ${tag} at ${commit}.`);
}

/** Creates the GitHub Release for `tag`, with generated notes, unless it exists. */
async function createRelease(tag) {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (token === undefined || repository === undefined) {
    console.log("No GITHUB_TOKEN or GITHUB_REPOSITORY; not creating a GitHub Release.");
    return;
  }
  const api = (process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/?$/, "/");
  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2022-11-28",
  };
  const existing = await fetch(new URL(`repos/${repository}/releases/tags/${tag}`, api), {
    headers,
    signal: timeout(),
  });
  if (existing.ok) {
    console.log(`GitHub Release ${tag} already exists.`);
    return;
  }
  if (existing.status !== 404) {
    throw new Error(`GitHub Release lookup for ${tag} failed: HTTP ${existing.status}`);
  }
  const created = await fetch(new URL(`repos/${repository}/releases`, api), {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ tag_name: tag, name: tag, generate_release_notes: true }),
    signal: timeout(),
  });
  if (!created.ok) {
    throw new Error(`Creating GitHub Release ${tag} failed: HTTP ${created.status}`);
  }
  console.log(`Created GitHub Release ${tag}.`);
}

const packages = members();
const pending = await unpublishedPackages(packages, registry());
if (pending.length > 0) {
  console.log(JSON.stringify({ event: "release_unpublished", packages: pending }));
  console.log("Not every version is on the registry; rerun this release job once it is.");
} else {
  const { version } = JSON.parse(readFileSync("package.json", "utf8"));
  const tag = `v${version}`;
  // The commit whose diff added the current version line; HEAD if history lacks it.
  const versionLine = `"version":[[:space:]]*"${version.replaceAll(".", "\\.")}"`;
  const commit =
    git(["log", "-1", "--format=%H", `-G${versionLine}`, "--", "package.json"]) ||
    git(["rev-parse", "HEAD"]);
  pushTag(tag, commit);
  await createRelease(tag);
  console.log(JSON.stringify({ event: "release_tagged", tag, commit }));
}
