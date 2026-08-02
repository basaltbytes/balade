/**
 * The served-mode payload cache (DECISIONS.md, "Resolution shells out through
 * `spawnSync`"): one entry keyed `(sourcePath, pin, head)` holding the whole
 * compiled payload. Keying costs one file read and one `git rev-parse`; a miss
 * costs the twenty-five processes of a full resolve, so the resolver runs once
 * per key and never per request.
 */

import { Context, Effect, Layer, Option } from "effect";
import type { LoadError, LoadResult } from "../compile/load.js";
import { ServerRepo, type ServerRepoError, type ServerRepoShape } from "./repo.js";

export interface PayloadCacheShape {
  readonly get: (sourcePath: string) => Effect.Effect<LoadResult, PayloadCacheError>;
  /** Drops what the watcher saw change, so the next request compiles again. */
  readonly invalidate: (sourcePath: string) => Effect.Effect<void>;
}

export type PayloadCacheError = LoadError | ServerRepoError;

export class PayloadCache extends Context.Service<PayloadCache, PayloadCacheShape>()(
  "@balade/PayloadCache",
) {
  static readonly layer = Layer.effect(
    PayloadCache,
    Effect.gen(function* () {
      return makePayloadCache(yield* ServerRepo);
    }),
  );
}

function makePayloadCache(source: ServerRepoShape): PayloadCacheShape {
  const slots = new Map<string, { key: string; result: LoadResult }>();

  const keyOf = Effect.fn("payloadCache.keyOf")(function* (sourcePath: string) {
    const pin = yield* source.pin(sourcePath);
    const head = yield* source.head;
    return [sourcePath, Option.getOrElse(pin, () => ""), head].join("\0");
  });

  return {
    get: Effect.fn("PayloadCache.get")(function* (sourcePath) {
      const key = yield* keyOf(sourcePath);
      const slot = slots.get(sourcePath);
      if (slot !== undefined && slot.key === key) return slot.result;

      const result = yield* source.load(sourcePath);
      slots.set(sourcePath, { key, result });
      return result;
    }),

    invalidate: Effect.fn("PayloadCache.invalidate")((sourcePath) =>
      Effect.sync(() => {
        slots.delete(sourcePath);
      }),
    ),
  };
}
