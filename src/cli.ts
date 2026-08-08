#!/usr/bin/env node
/** Entry point: mount the commands, compose the live layers once, run. */

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { Command } from "effect/unstable/cli";
import { buildCommand } from "./commands/build/index.js";
import { checkCommand } from "./commands/check/index.js";
import { generateCommand } from "./commands/generate/index.js";
import { openCommand } from "./commands/open/index.js";
import { skillsCommand } from "./commands/skills/index.js";
import { contextResolverLive } from "./git/git.js";
import { piWalkthroughAuthorLive } from "./pi/client.js";
import { PrLocator } from "./commands/open/locator.js";
import { BrowserLauncher } from "./server/browser.js";
import { CommandExecutor } from "./shell.js";

const VERSION = "0.6.2";

/** Host services and the process adapters used by the effectful shell. */
const shellLayer = Layer.mergeAll(NodeServices.layer, CommandExecutor.layer, BrowserLauncher.layer);

/** The complete command-line layer, provided once. */
const cliLayer = Layer.mergeAll(PrLocator.layer, piWalkthroughAuthorLive, contextResolverLive).pipe(
  Layer.provideMerge(shellLayer),
);

const balade = Command.make("balade").pipe(
  Command.withDescription("Narrated code walkthroughs for pull requests"),
  Command.withSubcommands([
    checkCommand,
    openCommand,
    buildCommand,
    generateCommand,
    skillsCommand,
  ]),
);

NodeRuntime.runMain(Command.run(balade, { version: VERSION }).pipe(Effect.provide(cliLayer)));
