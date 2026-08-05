/** The production shell layers at real fixture seams, mirroring `src/cli.ts`. */

import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { piWalkthroughAuthorLive } from "../../src/pi/client.js";
import { PrLocator } from "../../src/pr/locate.js";
import { BrowserLauncher } from "../../src/server/browser.js";
import { CommandExecutor } from "../../src/shell.js";

/** Host services and the process adapters used by the effectful shell. */
export const shellLayer = Layer.mergeAll(
  NodeServices.layer,
  CommandExecutor.layer,
  BrowserLauncher.layer,
);

/** The complete command-line layer, as `src/cli.ts` provides it. */
export const cliLayer = Layer.mergeAll(PrLocator.layer, piWalkthroughAuthorLive).pipe(
  Layer.provideMerge(shellLayer),
);

export const provideLive = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(cliLayer));
