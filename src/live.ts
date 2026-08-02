/** Live dependency graph shared by every CLI command. */

import { NodeServices } from "@effect/platform-node";
import { Layer } from "effect";
import { PrLocator } from "./pr/locate.js";
import { CommandExecutor } from "./resolve/exec.js";

/** Host services and the synchronous process adapter used by the effectful shell. */
export const shellLayer = Layer.mergeAll(NodeServices.layer, CommandExecutor.layer);

/** The complete command-line layer, provided once by `src/cli.ts`. */
export const cliLayer = PrLocator.layer.pipe(Layer.provideMerge(shellLayer));
