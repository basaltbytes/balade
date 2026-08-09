/** The browser runtime: constructed once and reused by every React effect. */

import { Effect, Exit, Layer, ManagedRuntime } from "effect";
import { shikiLayer, SyntaxHighlighter } from "../highlight/shiki";
import { browserLayer, type BrowserFetch, type BrowserStorage } from "./browser";
import { ReviewStore, reviewStoreLayer } from "./store";

const appLayer = Layer.merge(reviewStoreLayer.pipe(Layer.provideMerge(browserLayer)), shikiLayer);
const appRuntime = ManagedRuntime.make(appLayer);

type AppServices = BrowserFetch | BrowserStorage | ReviewStore | SyntaxHighlighter;

const logUnexpectedDefects = <A>(effect: Effect.Effect<A, never, AppServices>) =>
  effect.pipe(
    Effect.tapDefect((defect) =>
      Effect.logError("balade: an unexpected app effect failed.", defect),
    ),
  );

/**
 * Cross the React boundary with an already-handled Effect. The returned
 * interruptor is a `useEffect` cleanup function and aborts interruptible IO.
 */
export const runAppEffect = <A>(
  effect: Effect.Effect<A, never, AppServices>,
  onSuccess: (value: A) => void,
  options?: Effect.RunOptions,
): (() => void) =>
  appRuntime.runCallback(logUnexpectedDefects(effect), {
    ...options,
    onExit: Exit.match({ onFailure: () => undefined, onSuccess }),
  });

/** Run a handled reporting effect that has no React state callback or cleanup. */
export const reportAppEffect = (effect: Effect.Effect<void, never, AppServices>): void => {
  void appRuntime.runCallback(logUnexpectedDefects(effect), { onExit: () => undefined });
};
