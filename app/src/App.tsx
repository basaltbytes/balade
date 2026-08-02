import { useCallback, useEffect, useMemo, useState } from "react";
import { loadPayload, type Loaded } from "./data/source";
import { stringsFor, type Lang } from "./i18n";
import { IndexRoute } from "./routes/index-route";
import { WalkthroughRoute } from "./routes/walkthrough";
import { Octicon } from "./ui/octicon";
import { StringsProvider, useStrings } from "./ui/strings";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; loaded: Loaded };

const browserLang = (): Lang =>
  typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("fr")
    ? "fr"
    : "en";

function Splash({ state, onRetry }: { state: State; onRetry: () => void }) {
  const strings = useStrings();
  return (
    <div className="mx-auto max-w-[640px] px-6 py-24 text-center">
      {state.status === "loading" ? (
        <p className="text-muted-foreground">{strings.loading}</p>
      ) : (
        <>
          <p className="text-foreground inline-flex items-center gap-2 justify-center">
            <Octicon name="alert" size={16} className="text-destructive" />
            {strings.loadFailed}
          </p>
          {state.status === "error" && state.message.length > 0 && (
            <p className="mt-2 font-mono text-[12px] text-muted-foreground">{state.message}</p>
          )}
          <button
            type="button"
            onClick={onRetry}
            className="mt-5 border border-border rounded-md px-3 py-[5px] text-[13px] text-secondary-foreground hover:text-foreground hover:border-primary cursor-pointer"
          >
            {strings.retry}
          </button>
        </>
      )}
    </div>
  );
}

/* The fixture ships with a settled head; the dev toggle moves it so the stale
   banner can be seen without editing the payload. */
function WalkthroughView({ loaded }: { loaded: Extract<Loaded, { kind: "walkthrough" }> }) {
  const [devStale, setDevStale] = useState(false);
  const payload = useMemo(
    () => (devStale ? { ...loaded.payload, headDistance: 2 } : loaded.payload),
    [loaded.payload, devStale],
  );
  return (
    <StringsProvider lang={payload.lang}>
      <WalkthroughRoute
        payload={payload}
        served={loaded.served}
        devStale={devStale}
        onToggleDevStale={import.meta.env.DEV ? () => setDevStale((value) => !value) : null}
      />
    </StringsProvider>
  );
}

export default function App() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const lang = browserLang();

  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    loadPayload(window.location, stringsFor(lang).payloadUnreadable)
      .then((loaded) => {
        if (alive) setState({ status: "ready", loaded });
      })
      .catch((error: unknown) => {
        if (alive)
          setState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
      });
    return () => {
      alive = false;
    };
  }, [attempt, lang]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (state.status !== "ready") {
    return (
      <StringsProvider lang={lang}>
        <Splash state={state} onRetry={retry} />
      </StringsProvider>
    );
  }

  if (state.loaded.kind === "index") {
    return (
      <StringsProvider lang={lang}>
        <IndexRoute payload={state.loaded.payload} locale={lang} />
      </StringsProvider>
    );
  }

  return <WalkthroughView loaded={state.loaded} />;
}
