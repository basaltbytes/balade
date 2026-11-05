/**
 * The pnpm that runs `pnpm changeset:publish` also runs the release scripts'
 * pnpm commands, so the registry and the workspace listing come from its own
 * configuration.
 */
import { execFileSync } from "node:child_process";
import { basename } from "node:path";

const execpath = process.env.npm_execpath;
const pnpm =
  execpath !== undefined && basename(execpath).startsWith("pnpm")
    ? [process.execPath, execpath]
    : ["pnpm"];

/** Runs a pnpm command and returns its stdout. */
export const run = (args, options = {}) =>
  execFileSync(pnpm[0], [...pnpm.slice(1), ...args], { encoding: "utf8", ...options });

/** The configured registry, with a trailing slash. */
export const registry = () =>
  new URL(run(["config", "get", "registry"]).trim().replace(/\/?$/, "/"));

/** Every publishable workspace member, the root `balade` package included. */
export const members = () =>
  JSON.parse(
    run(["list", "--recursive", "--include-workspace-root", "--depth", "-1", "--json"]),
  ).filter((member) => member.private !== true);
