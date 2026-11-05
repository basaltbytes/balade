/**
 * Stage every workspace package whose version npm does not have yet, the root
 * `balade` package included: `pnpm stage publish -r` leaves the root out.
 *
 * Runs under pnpm (`pnpm changeset:publish`), so the registry comes from pnpm's
 * own configuration and the invoking pnpm runs the publishes.
 */
import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { unpublishedPackages } from "./registry.mjs";

const execpath = process.env.npm_execpath;
const pnpm =
  execpath !== undefined && basename(execpath).startsWith("pnpm")
    ? [process.execPath, execpath]
    : ["pnpm"];
const run = (args, options = {}) =>
  execFileSync(pnpm[0], [...pnpm.slice(1), ...args], { encoding: "utf8", ...options });

const registry = new URL(run(["config", "get", "registry"]).trim().replace(/\/?$/, "/"));
const members = JSON.parse(
  run(["list", "--recursive", "--include-workspace-root", "--depth", "-1", "--json"]),
).filter((member) => member.private !== true);
const pending = new Set(await unpublishedPackages(members, registry));

for (const member of members) {
  const spec = `${member.name}@${member.version}`;
  if (!pending.has(spec)) {
    console.log(`${spec} is on the registry; not staged again.`);
    continue;
  }
  run(
    [
      "stage",
      "publish",
      "--tag",
      "latest",
      "--access",
      "public",
      "--no-git-checks",
      "--ignore-scripts",
    ],
    { cwd: member.path, stdio: "inherit" },
  );
}
