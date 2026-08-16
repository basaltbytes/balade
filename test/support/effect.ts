/** The production shell layers at real fixture seams, mirroring `src/cli.ts`. */

import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import {
  AgentModelManager,
  AgentModelSetupRequired,
  NoProviderAuthenticated,
} from "../../src/agent/model.js";
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

const agentModelManagerTest = Layer.succeed(AgentModelManager, {
  status: Effect.succeed(new AgentModelSetupRequired()),
  ensure: new NoProviderAuthenticated({ requested: "any provider/any model" }),
  configure: () => new NoProviderAuthenticated({ requested: "any provider/any model" }),
});

/** Production adapters plus inert test seams for model setup and agent presence. */
export const cliLayer = Layer.mergeAll(
  PrLocator.layer,
  piWalkthroughAuthorLive,
  piWalkthroughClarifierLive,
  agentModelManagerTest,
  contextResolverLive,
  AgentPresence.noop,
).pipe(Layer.provideMerge(shellLayer));

export const provideLive = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(cliLayer));
