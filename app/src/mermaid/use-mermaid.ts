import { Effect } from "effect";
import { createContext, useContext, useEffect, useState } from "react";
import { runAppEffect } from "../data/runtime";
import {
  lazyMermaidRenderer,
  logMermaidFailure,
  type MermaidRenderer,
  renderDiagram,
} from "./mermaid";

/** The renderer a test replaces; production reads the lazy mermaid import. */
export const MermaidRendererContext = createContext<MermaidRenderer>(lazyMermaidRenderer);

export type Diagram =
  | { readonly state: "pending" }
  | { readonly state: "drawn"; readonly svg: string }
  | { readonly state: "unavailable" };

const PENDING: Diagram = { state: "pending" };
const UNAVAILABLE: Diagram = { state: "unavailable" };

let drawn = 0;

/* Mermaid writes this id into CSS selectors of the stylesheet it embeds, so it
   has to be selector-safe — which React's own `useId` output is not. */
const nextDiagramId = (): string => `balade-mermaid-${(drawn += 1)}`;

/**
 * Mermaid needs a document, so a diagram is `pending` through server rendering
 * and until the browser draws it. An empty source never reaches mermaid.
 */
export function useMermaidDiagram(source: string): Diagram {
  const renderer = useContext(MermaidRendererContext);
  const [diagram, setDiagram] = useState<Diagram>(PENDING);

  useEffect(() => {
    if (source === "") {
      setDiagram(UNAVAILABLE);
      return;
    }
    setDiagram(PENDING);
    return runAppEffect(
      renderDiagram(renderer, nextDiagramId(), source).pipe(
        Effect.map((svg): Diagram => ({ state: "drawn", svg })),
        Effect.catch((error) => logMermaidFailure(error).pipe(Effect.as(UNAVAILABLE))),
      ),
      setDiagram,
    );
  }, [renderer, source]);

  return diagram;
}
