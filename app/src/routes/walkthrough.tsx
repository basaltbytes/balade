/* The walkthrough route: nav on the left, the document on the right, review
   marks on both. */

import { useEffect, useMemo } from "react";
import type { ErrorCard, Payload, Section } from "../contract";
import type { ReviewStoreTarget } from "../data/store";
import { ensureLangs } from "../highlight/shiki";
import { Chip, MarkButton } from "../ui/bits";
import {
  CompleteBanner,
  ErrorCards,
  Header,
  PersistBadge,
  ResetBanner,
  StaleBanner,
} from "../ui/chrome";
import { JumpLink, Nav } from "../ui/nav";
import { Octicon } from "../ui/octicon";
import { PayloadProvider } from "../ui/payload-context";
import {
  ReviewProvider,
  SectionProvider,
  useReview,
  useReviewApi,
  type ReviewApi,
} from "../ui/review-context";
import { useStrings } from "../ui/strings";
import { BlockView } from "../widgets";

/** Every grammar the payload needs, loaded once instead of per block. */
function usePayloadLanguages(payload: Payload): void {
  useEffect(() => {
    const langs = new Set<string>();
    for (const file of payload.files) langs.add(file.lang);
    for (const section of payload.sections) {
      for (const block of section.blocks) if (block.b === "code") langs.add(block.lang);
    }
    void ensureLangs(langs);
  }, [payload]);
}

function SectionView({
  section,
  errors,
  titles,
}: {
  section: Section;
  errors: ErrorCard[];
  titles: Map<string, string>;
}) {
  const review = useReview();
  const strings = useStrings();
  const reviewed = review.sectionReviewed(section.id);
  const files = review.filesOf(section);

  return (
    <SectionProvider id={section.id}>
      <section id={section.id} className={`mb-12 ${reviewed ? "reviewed-section" : ""}`}>
        <div className="section-head flex items-center flex-wrap gap-2.5 border-b border-border pb-2 mb-4">
          <Octicon name={section.icon} size={17} className="text-muted-foreground" />
          <h2 className="text-[18px] font-semibold">{section.title}</h2>
          {section.badge && <Chip tone={section.badge.tone}>{section.badge.label}</Chip>}
          {section.file !== undefined && (
            <span className="font-mono text-[12px] text-muted-foreground truncate">
              {section.file}
            </span>
          )}
          <span className="ml-auto flex items-center gap-3">
            {files && (
              <span className="text-[11.5px] text-muted-foreground tabular-nums">
                {strings.filesViewed(files.done, files.total)}
              </span>
            )}
            {reviewed && <Octicon name="check-circle-fill" size={15} className="text-added" />}
          </span>
        </div>

        <div className="section-body">
          {section.relatedFiles !== undefined && section.relatedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {section.relatedFiles.map((ref) => (
                <JumpLink key={ref} id={ref}>
                  <Chip icon="link">{titles.get(ref) ?? ref}</Chip>
                </JumpLink>
              ))}
            </div>
          )}

          <ErrorCards errors={errors} />

          {section.blocks.map((block, index) => (
            <BlockView key={index} block={block} />
          ))}

          <div className="mt-6 flex justify-end">
            <MarkButton
              reviewed={reviewed}
              onToggle={() => review.markSection(section.id)}
              disabled={!review.ready}
            />
          </div>
        </div>
      </section>
    </SectionProvider>
  );
}

function Document({
  payload,
  devStale,
  onToggleDevStale,
}: {
  payload: Payload;
  devStale: boolean;
  onToggleDevStale: (() => void) | null;
}) {
  const review: ReviewApi = useReview();
  const strings = useStrings();
  /* Rebuilt only when the payload changes, not on every mark. */
  const { titles, globalErrors, errorsBySection } = useMemo(() => {
    const titles = new Map(payload.sections.map((section) => [section.id, section.title]));
    const globalErrors = payload.errors.filter((error) => error.sectionId === undefined);
    const errorsBySection = new Map<string, ErrorCard[]>();
    for (const error of payload.errors) {
      if (error.sectionId === undefined) continue;
      const list = errorsBySection.get(error.sectionId) ?? [];
      list.push(error);
      errorsBySection.set(error.sectionId, list);
    }
    return { titles, globalErrors, errorsBySection };
  }, [payload]);

  return (
    <div
      className={`mx-auto max-w-[1280px] flex gap-8 px-6 ${review.hideReviewed ? "hide-reviewed" : ""}`}
    >
      <aside className="w-[268px] shrink-0 hidden md:block">
        <div className="sticky top-0 max-h-screen overflow-y-auto py-8 pr-2">
          <Nav payload={payload} />
        </div>
      </aside>

      <main className="min-w-0 flex-1 max-w-[960px] py-8">
        <Header payload={payload} />
        <StaleBanner headDistance={payload.headDistance} />
        <PersistBadge />
        <ResetBanner />
        <CompleteBanner />
        <ErrorCards errors={globalErrors} />

        {payload.sections.map((section) => (
          <SectionView
            key={section.id}
            section={section}
            errors={errorsBySection.get(section.id) ?? []}
            titles={titles}
          />
        ))}

        <footer className="border-t border-border pt-4 text-[12.5px] text-muted-foreground flex items-center gap-3 flex-wrap">
          <span className="font-mono">{payload.sourcePath}</span>
          <span>·</span>
          <span>{strings.readOnlyArtifact}</span>
          {onToggleDevStale && (
            <button
              type="button"
              onClick={onToggleDevStale}
              aria-pressed={devStale}
              className="ml-auto border border-border rounded-md px-2 py-[2px] text-[11px] hover:text-foreground hover:border-primary cursor-pointer"
            >
              {strings.devToggleStale}
            </button>
          )}
        </footer>
      </main>
    </div>
  );
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
  const target = useMemo<ReviewStoreTarget>(
    () =>
      served
        ? {
            mode: "served",
            storageKey: payload.storageKey,
            sourcePath: payload.sourcePath,
          }
        : { mode: "export", storageKey: payload.storageKey },
    [payload.sourcePath, payload.storageKey, served],
  );
  const review = useReviewApi(payload, target);
  usePayloadLanguages(payload);

  useEffect(() => {
    document.title = `${payload.title} · #${payload.pr.number}`;
    document.documentElement.lang = payload.lang;
  }, [payload]);

  return (
    <PayloadProvider value={payload}>
      <ReviewProvider value={review}>
        <Document payload={payload} devStale={devStale} onToggleDevStale={onToggleDevStale} />
      </ReviewProvider>
    </PayloadProvider>
  );
}
