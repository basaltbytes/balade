/** Pi's faux provider behind the real author layer, on in-memory stores and a throwaway snapshot cache. */

import * as ai from "@earendil-works/pi-ai";
import * as coding from "@earendil-works/pi-coding-agent";
import type { SettingsManager } from "@earendil-works/pi-coding-agent";
import type { NodeServices } from "@effect/platform-node";
import { Layer } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contextResolverLive } from "../../src/git/git.js";
import { piWalkthroughAuthorLayer } from "../../src/pi/client.js";
import type { CommandExecutor } from "../../src/shell.js";
import { shellLayer } from "./effect.js";

const harnessCleanups: Array<() => void> = [];

/** Runs `cleanup` with the current test's harness cleanups. */
export function deferCleanup(cleanup: () => void): void {
  harnessCleanups.push(cleanup);
}

/** Removes every snapshot cache the current test's harnesses created; call it from `afterEach`. */
export function releasePiHarnesses(): void {
  for (const cleanup of harnessCleanups.splice(0)) cleanup();
}

export interface PiHarnessOptions {
  /** `false` leaves no provider registered: the authenticated-model list is empty. */
  readonly faux?: boolean;
  readonly settingsManager?: SettingsManager;
  /** The shell the author layer runs on; swap it to fake `gh` or the file system. */
  readonly shell?: Layer.Layer<CommandExecutor | NodeServices.NodeServices>;
}

export async function piHarness(options: PiHarnessOptions = {}) {
  const settingsManager = options.settingsManager ?? coding.SettingsManager.inMemory();
  const snapshotCacheRoot = mkdtempSync(join(tmpdir(), "balade-pi-snapshots-"));
  harnessCleanups.push(() =>
    rmSync(snapshotCacheRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  );
  const credentials = new ai.InMemoryCredentialStore();
  const modelRuntime = await coding.ModelRuntime.create({
    credentials,
    modelsPath: null,
    allowModelNetwork: false,
  });
  const faux = ai.fauxProvider();
  if (options.faux !== false) {
    modelRuntime.registerNativeProvider(faux.provider);
    await modelRuntime.refresh({ allowNetwork: false });
  }
  const layer = Layer.mergeAll(
    piWalkthroughAuthorLayer({
      snapshotCacheRoot,
      load: async () => ({ coding, ai, modelRuntime, settingsManager }),
    }),
    contextResolverLive,
  ).pipe(Layer.provideMerge(options.shell ?? shellLayer));
  return { credentials, faux, layer, modelRuntime, settingsManager, snapshotCacheRoot };
}
