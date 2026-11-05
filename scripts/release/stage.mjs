/**
 * Stage every workspace package whose version npm does not have yet, the root
 * `balade` package included: `pnpm stage publish -r` leaves the root out.
 */
import { members, registry, run } from "./pnpm.mjs";
import { unpublishedPackages } from "./registry.mjs";

const packages = members();
const pending = new Set(await unpublishedPackages(packages, registry()));

for (const member of packages) {
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
