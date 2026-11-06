/**
 * Publish every workspace package whose version npm does not have yet, the root
 * `balade` package included, then wait until the registry serves them so that
 * tag.mjs, which runs next, finds them public in the same job.
 *
 * Publishing is direct, through OIDC trusted publishing; the merged Version
 * Packages PR is the review. Versions npm already has are not retried.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { members, registry, run } from "./pnpm.mjs";
import { unpublishedPackages } from "./registry.mjs";

const target = registry();
const packages = members();
const pending = new Set(await unpublishedPackages(packages, target));

const published = [];
for (const member of packages) {
  const spec = `${member.name}@${member.version}`;
  if (!pending.has(spec)) {
    console.log(`${spec} is on the registry; not published again.`);
    continue;
  }
  run(["publish", "--tag", "latest", "--access", "public", "--no-git-checks", "--ignore-scripts"], {
    cwd: member.path,
    stdio: "inherit",
  });
  published.push(member);
}

// The registry can take a moment to serve a fresh version.
const deadline = Date.now() + 180_000;
let missing = await unpublishedPackages(published, target);
while (missing.length > 0 && Date.now() < deadline) {
  await sleep(5_000);
  missing = await unpublishedPackages(published, target);
}
if (missing.length > 0) {
  throw new Error(`Published but not served by the registry yet: ${missing.join(", ")}`);
}
console.log(JSON.stringify({ event: "release_published", packages: published.length }));
