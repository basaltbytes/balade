#!/usr/bin/env node
/** Entry point: mount the commands, compose the live layers once, run. */

import { createRequire } from "node:module";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Layer, Schema } from "effect";
import { Command } from "effect/unstable/cli";
import { buildCommand } from "./commands/build/index.js";
import { checkCommand } from "./commands/check/index.js";
import { generateCommand } from "./commands/generate/index.js";
import { openCommand } from "./commands/open/index.js";
import { skillsCommand } from "./commands/skills/index.js";
import { contextResolverLive } from "./git/git.js";
import { piWalkthroughAuthorLive } from "./pi/client.js";
import { PrLocator } from "./commands/open/locator.js";
import { agentPresenceLive } from "./presence.js";
import { BrowserLauncher } from "./server/browser.js";
import { CommandExecutor } from "./shell.js";

const PackageManifest = Schema.Struct({ version: Schema.String });
const packageManifest: unknown = createRequire(import.meta.url)("../package.json");
const packageVersion = Schema.decodeUnknownSync(PackageManifest)(packageManifest).version;

/** Host services and the process adapters used by the effectful shell. */
const shellLayer = Layer.mergeAll(NodeServices.layer, CommandExecutor.layer, BrowserLauncher.layer);

/** The complete command-line layer, provided once. */
const cliLayer = Layer.mergeAll(
  PrLocator.layer,
  piWalkthroughAuthorLive,
  contextResolverLive,
  agentPresenceLive,
).pipe(Layer.provideMerge(shellLayer));

const balade = Command.make("balade").pipe(
  Command.withDescription("Human-readable walkthroughs for agent-scale pull requests"),
  Command.withSubcommands([
    checkCommand,
    openCommand,
    buildCommand,
    generateCommand,
    skillsCommand,
  ]),
);

NodeRuntime.runMain(
  Command.run(balade, { version: packageVersion }).pipe(Effect.provide(cliLayer)),
);
