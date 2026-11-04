import { Effect, Predicate, Result } from "effect";
import { useEffect, useMemo, type CSSProperties, type ReactNode } from "react";
import { decodePayload } from "../../src/contract/payload";
import type { Payload } from "./contract";
import type { WalkthroughHost } from "./host";
import { ensureLangs, withHighlightFallback } from "./highlight/shiki";
import { NavigationProvider, useNavigation, type NavigationProps } from "./ui/navigation-context";
import { PayloadProvider, usePayload } from "./ui/payload-context";
import { QaProvider } from "./ui/qa-context";
import { QaPanel, SelectionAsk } from "./ui/qa";
import { RenderRuntimeProvider, useRenderEffect } from "./ui/render-runtime";
import { ReviewProvider, useReviewApi } from "./ui/review-context";
import { SheetNav } from "./ui/sheet-nav";
import { StringsProvider, useStrings } from "./ui/strings";
import { WalkthroughHeader, WalkthroughNav, WalkthroughSections } from "./ui/walkthrough-parts";
import { ViewportOverlay, ViewportProvider } from "./ui/viewport";

export { Diff, type DiffProps, type DiffFile, type DiffPatch } from "./diff";
export type { WalkthroughHost } from "./host";
export { ClarificationAgentUnavailable, ClarificationGenerationChanged } from "./host";
export type {
  Payload,
  Block,
  QaTurn,
  QaState,
  QaAgentStatus,
  QaAskRequest,
  ReviewState,
} from "./contract";

export interface WalkthroughProps extends NavigationProps {
  /** A compiled payload, decoded at this boundary even for JavaScript consumers. */
  readonly payload: unknown;
  readonly host?: WalkthroughHost;
  readonly headDistance?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export interface WalkthroughRootProps extends WalkthroughProps {
  readonly children: ReactNode;
}

function Root({
  payload: input,
  host,
  headDistance,
  children,
  className,
  style,
  ...navigation
}: WalkthroughRootProps) {
  const decoded = useMemo(() => Effect.runSync(decodePayload(input).pipe(Effect.result)), [input]);
  if (Result.isFailure(decoded)) {
    const lang = Predicate.hasProperty(input, "lang") && input.lang === "fr" ? "fr" : "en";
    return (
      <StringsProvider lang={lang}>
        <div className={`balade-viewer ${className ?? ""}`} style={style} lang={lang}>
          <PayloadError unsupported={decoded.failure._tag === "PayloadFormatUnsupported"} />
        </div>
      </StringsProvider>
    );
  }
  const payload = decoded.success;
  return (
    <RenderRuntimeProvider>
      <StringsProvider lang={payload.lang}>
        <NavigationProvider {...navigation} content={payload}>
          <ViewerState
            payload={payload}
            host={host}
            headDistance={headDistance}
            className={className}
            style={style}
          >
            {children}
          </ViewerState>
        </NavigationProvider>
      </StringsProvider>
    </RenderRuntimeProvider>
  );
}

function PayloadError({ unsupported }: { unsupported: boolean }) {
  const strings = useStrings();
  return (
    <p role="alert" className="px-6 py-8">
      {unsupported ? strings.payloadFormatUnsupported : strings.payloadUnreadable}
    </p>
  );
}

function ViewerState({
  payload,
  host,
  headDistance,
  children,
  className,
  style,
}: {
  payload: Payload;
  host: WalkthroughHost | undefined;
  headDistance: number | undefined;
  children: ReactNode;
  className: string | undefined;
  style: CSSProperties | undefined;
}) {
  const review = useReviewApi(payload, host?.reviewState);
  const run = useRenderEffect();
  const { root, scrollRoot } = useNavigation();
  const presentation = useMemo(
    () => (headDistance === undefined ? payload : { ...payload, headDistance }),
    [payload, headDistance],
  );
  useEffect(() => {
    const langs = new Set(payload.files.map((file) => file.lang));
    for (const section of payload.sections) {
      for (const block of section.blocks) if (block.b === "code") langs.add(block.lang);
    }
    return run(ensureLangs([...langs]).pipe(withHighlightFallback(undefined)), () => undefined);
  }, [payload, run]);
  return (
    <div
      ref={root}
      lang={payload.lang}
      className={`balade-viewer ${review.hideReviewed ? "hide-reviewed" : ""} ${className ?? ""}`}
      style={style}
    >
      <PayloadProvider value={presentation}>
        <ReviewProvider value={review}>
          <QaProvider payload={payload} host={host?.clarifications}>
            <ViewportProvider root={root} scrollRoot={scrollRoot}>
              {children}
            </ViewportProvider>
          </QaProvider>
        </ReviewProvider>
      </PayloadProvider>
    </div>
  );
}

function Clarifications({ layout = "inline" }: { layout?: "inline" | "drawer" }) {
  return (
    <>
      <SelectionAsk />
      {layout === "drawer" ? (
        <ViewportOverlay>
          <QaPanel layout="drawer" />
        </ViewportOverlay>
      ) : (
        <QaPanel layout="inline" />
      )}
    </>
  );
}

function DefaultLayout() {
  const payload = usePayload();
  const { active } = useNavigation();
  const strings = useStrings();
  return (
    <>
      <div className="mx-auto max-w-[1280px] flex gap-8 px-4 @min-[640px]:px-6">
        <aside className="w-[268px] shrink-0 hidden @min-[768px]:block">
          <div className="sticky top-0 max-h-screen overflow-y-auto py-8 pr-2">
            <WalkthroughNav />
          </div>
        </aside>
        <main className="min-w-0 flex-1 max-w-[960px] py-8 pb-28 @min-[768px]:pb-8">
          <WalkthroughHeader />
          <WalkthroughSections />
          <footer className="border-t border-border pt-4 text-[12.5px] text-muted-foreground flex items-center gap-3 flex-wrap">
            <span className="font-mono">{payload.sourcePath}</span>
            <span>·</span>
            <span>{strings.readOnlyArtifact}</span>
          </footer>
        </main>
      </div>
      <SheetNav payload={payload} active={active} />
      <Clarifications layout="drawer" />
    </>
  );
}

/** The default responsive layout, built from the same composable parts. */
export function WalkthroughView(props: WalkthroughProps) {
  return (
    <Root {...props}>
      <DefaultLayout />
    </Root>
  );
}

export const Walkthrough = {
  Root,
  Header: WalkthroughHeader,
  Nav: WalkthroughNav,
  Sections: WalkthroughSections,
  Clarifications,
};
