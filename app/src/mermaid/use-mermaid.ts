import { Effect } from "effect";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useRenderEffect } from "../ui/render-runtime";
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

/**
 * Mermaid needs a document, so a diagram is `pending` through server rendering
 * and until the browser draws it. An empty source never reaches mermaid.
 */
export function useMermaidDiagram(
  source: string,
  stage: RefObject<HTMLDivElement | null>,
): Diagram {
  const runAppEffect = useRenderEffect();
  const instance = useId();
  const draw = useRef(0);
  const renderer = useContext(MermaidRendererContext);
  const [diagram, setDiagram] = useState<Diagram>(PENDING);

  useEffect(() => {
    const container = stage.current;
    if (source === "" || container === null) {
      setDiagram(UNAVAILABLE);
      return;
    }
    setDiagram(PENDING);
    draw.current += 1;
    return runAppEffect(
      renderDiagram(
        renderer,
        `balade-mermaid-${instance.replace(/[^a-zA-Z0-9_-]/g, "")}-${draw.current}`,
        source,
        container,
      ).pipe(
        Effect.map((svg): Diagram => ({ state: "drawn", svg })),
        Effect.catch((error) => logMermaidFailure(error).pipe(Effect.as(UNAVAILABLE))),
      ),
      setDiagram,
    );
  }, [instance, renderer, source, stage, runAppEffect]);

  return diagram;
}
