/** The production shell layer at real fixture seams. */

import { Effect } from "effect";
import { cliLayer } from "../../src/live.js";

export const provideLive = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(cliLayer));
