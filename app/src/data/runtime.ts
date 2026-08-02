/** The browser runtime: constructed once and reused by every React effect. */

import { Effect, Exit, Layer, ManagedRuntime } from "effect";
import { browserLayer, type BrowserFetch, type BrowserStorage } from "./browser";
import { ReviewStore, reviewStoreLayer } from "./store";

const appLayer = reviewStoreLayer.pipe(Layer.provideMerge(browserLayer));
const appRuntime = ManagedRuntime.make(appLayer);

type AppServices = BrowserFetch | BrowserStorage | ReviewStore;

/**
 * Cross the React boundary with an already-handled Effect. The returned
 * interruptor is a `useEffect` cleanup function and aborts interruptible IO.
 */
export const runAppEffect = <A>(
  effect: Effect.Effect<A, never, AppServices>,
  onSuccess: (value: A) => void,
  options?: Effect.RunOptions,
): (() => void) =>
  appRuntime.runCallback(
    effect.pipe(
      Effect.tapDefect((defect) =>
        Effect.logError("balade: an unexpected app effect failed.", defect),
      ),
    ),
    {
      ...options,
      onExit: Exit.match({ onFailure: () => undefined, onSuccess }),
    },
  );
