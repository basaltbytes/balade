/** A renderer runtime owns highlighting only. It has no browser storage or fetch capability. */
import { Effect, Exit, ManagedRuntime } from "effect";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { shikiLayer, type SyntaxHighlighter } from "../highlight/shiki";

function createRendererRuntime() {
  let runtime: ManagedRuntime.ManagedRuntime<SyntaxHighlighter, never> | undefined;
  return {
    run: <A,>(
      effect: Effect.Effect<A, never, SyntaxHighlighter>,
      onSuccess: (value: A) => void,
      options?: Effect.RunOptions,
    ): (() => void) => {
      runtime ??= ManagedRuntime.make(shikiLayer);
      return runtime.runCallback(
        effect.pipe(
          Effect.tapDefect((defect) => Effect.logError("balade: renderer failed", defect)),
        ),
        { ...options, onExit: Exit.match({ onFailure: () => undefined, onSuccess }) },
      );
    },
    dispose: () => {
      const previous = runtime;
      runtime = undefined;
      void previous?.dispose();
    },
  };
}

const RenderRuntime = createContext<ReturnType<typeof createRendererRuntime> | null>(null);

export function RenderRuntimeProvider({ children }: { children: ReactNode }) {
  const [runtime] = useState(createRendererRuntime);
  useEffect(() => () => runtime.dispose(), [runtime]);
  return <RenderRuntime.Provider value={runtime}>{children}</RenderRuntime.Provider>;
}

export function useRenderEffect() {
  const runtime = useContext(RenderRuntime);
  if (runtime === null) throw new Error("Renderer components require Walkthrough.Root");
  return runtime.run;
}
