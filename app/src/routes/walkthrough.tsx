/** Browser page ownership stays in the standalone app, outside balade/viewer. */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Payload } from "../contract";
import { createAppHost } from "../data/app-host";
import { WalkthroughView } from "../viewer";
import { useStrings } from "../ui/strings";

function readSectionHash(): string {
  try {
    return decodeURIComponent(window.location.hash.slice(1));
  } catch {
    return "";
  }
}

export function WalkthroughRoute({
  payload,
  served,
  devStale,
  onToggleDevStale,
}: {
  payload: Payload;
  served: boolean;
  devStale: boolean;
  onToggleDevStale: (() => void) | null;
}) {
  const host = useMemo(() => createAppHost(payload, served), [payload, served]);
  const [section, setSection] = useState(readSectionHash);
  const strings = useStrings();
  useEffect(() => {
    document.title = `${payload.title} · #${payload.pr.number}`;
    document.documentElement.lang = payload.lang;
    const onHash = (): void => setSection(readSectionHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [payload]);
  const navigate = useCallback((id: string) => {
    window.history.replaceState(null, "", `#${encodeURIComponent(id)}`);
    setSection(id);
  }, []);
  return (
    <>
      <WalkthroughView payload={payload} host={host} section={section} onSectionChange={navigate} />
      {onToggleDevStale && (
        <button type="button" onClick={onToggleDevStale} aria-pressed={devStale}>
          {strings.devToggleStale}
        </button>
      )}
    </>
  );
}
