/* Viewport width the renderer has to branch on, not just style on. A split
   diff needs two code columns side by side; below the `md` breakpoint there is
   room for one, so the mode is a render decision rather than a CSS one. */

import { useEffect, useState } from "react";

const WIDE = "(min-width: 768px)";

/** Wide is the default: the export's first paint and any host without
    `matchMedia` keep the layout this app was built for. */
export function useIsWide(): boolean {
  const [wide, setWide] = useState(
    () => globalThis.matchMedia === undefined || globalThis.matchMedia(WIDE).matches,
  );

  useEffect(() => {
    const query = globalThis.matchMedia(WIDE);
    const sync = (): void => setWide(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return wide;
}
