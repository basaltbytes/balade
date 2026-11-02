/** One root measurement owns responsive rendering and the local overlay viewport. */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

interface Viewport {
  readonly wide: boolean;
  readonly overlay: HTMLDivElement | null;
}

const ViewportContext = createContext<Viewport>({ wide: true, overlay: null });

export function ViewportProvider({
  root,
  scrollRoot,
  children,
}: {
  root: RefObject<HTMLDivElement | null>;
  scrollRoot: RefObject<HTMLElement | null> | undefined;
  children: ReactNode;
}) {
  const [overlay, setOverlay] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ wide: true, height: "100dvh" });
  useEffect(() => {
    const element = root.current;
    if (element === null) return;
    const measure = (): void => {
      const height = Math.min(element.clientHeight, scrollRoot?.current?.clientHeight ?? Infinity);
      setSize({ wide: element.clientWidth >= 768, height: `min(100dvh, ${height}px)` });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (scrollRoot?.current) observer.observe(scrollRoot.current);
    return () => observer.disconnect();
  }, [root, scrollRoot]);
  const value = useMemo(() => ({ wide: size.wide, overlay }), [size.wide, overlay]);
  const style: CSSProperties = { height: size.height, marginBottom: `calc(-1 * ${size.height})` };
  return (
    <ViewportContext.Provider value={value}>
      <div ref={setOverlay} className="balade-overlay-viewport" style={style} />
      {children}
    </ViewportContext.Provider>
  );
}

export function ViewportOverlay({ children }: { children: ReactNode }) {
  const { overlay } = useContext(ViewportContext);
  return overlay === null ? null : createPortal(children, overlay);
}

/** A split diff needs enough space in this viewer, independent of the host page's width. */
export function useIsWide(): boolean {
  return useContext(ViewportContext).wide;
}
