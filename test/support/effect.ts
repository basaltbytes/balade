/** The production shell layers at real fixture seams, mirroring `src/cli.ts`. */

import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { contextResolverLive } from "../../src/git/git.js";
import { piWalkthroughAuthorLive } from "../../src/pi/client.js";
import { piWalkthroughClarifierLive } from "../../src/pi/clarifier.js";
import { PrLocator } from "../../src/commands/open/locator.js";
import { AgentPresence } from "../../src/presence.js";
import { BrowserLauncher } from "../../src/server/browser.js";
import { CommandExecutor } from "../../src/shell.js";

/** Host services and the process adapters used by the effectful shell. */
export const shellLayer = Layer.mergeAll(
  NodeServices.layer,
  CommandExecutor.layer,
  BrowserLauncher.layer,
);

/** As `src/cli.ts` provides it, except presence: the suite never reports to a live multiplexer. */
export const cliLayer = Layer.mergeAll(
  PrLocator.layer,
  piWalkthroughAuthorLive,
  piWalkthroughClarifierLive,
  contextResolverLive,
  AgentPresence.noop,
).pipe(Layer.provideMerge(shellLayer));

export const provideLive = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(cliLayer));
