/** Predictable balade-owned state below the user's home directory. */

import { homedir } from "node:os";
import { join } from "node:path";

export function baladeStateDirectory(): string {
  return join(homedir(), ".balade");
}

export function baladePiAgentDirectory(): string {
  return join(baladeStateDirectory(), "pi");
}

export function baladeSnapshotCacheDirectory(): string {
  return join(baladeStateDirectory(), "cache", "snapshots");
}
