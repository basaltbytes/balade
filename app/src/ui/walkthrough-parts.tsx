import { useMemo } from "react";
import type { ErrorCard, Section } from "../contract";
import { Chip, MarkButton } from "./bits";
import {
  CompleteBanner,
  ErrorCards,
  Header,
  PersistBadge,
  ResetBanner,
  StaleBanner,
} from "./chrome";
import { JumpLink, Nav } from "./nav";
import { Octicon } from "./octicon";
import { usePayload } from "./payload-context";
import { QaIndicator } from "./qa";
import { SectionProvider, useReview } from "./review-context";
import { useStrings } from "./strings";
import { BlockView } from "../widgets";
import { useNavigation } from "./navigation-context";

function SectionView({
  section,
  errors,
  titles,
}: {
  section: Section;
  errors: ErrorCard[];
  titles: Map<string, string>;
}) {
  const { sectionId, active } = useNavigation();
  const review = useReview();
  const strings = useStrings();
  const reviewed = review.sectionReviewed(section.id);
  const files = review.filesOf(section);

  return (
    <SectionProvider id={section.id}>
      <section
        id={sectionId(section.id)}
        data-balade-section={section.id}
        className={`mb-16 ${reviewed ? "reviewed-section" : ""} ${active === section.id ? "is-active" : ""}`}
      >
        <div className="section-head flex items-center flex-wrap gap-2.5 mb-5">
          <Octicon name={section.icon} size={18} className="text-muted-foreground shrink-0" />
          <h2 className="text-section font-semibold tracking-[-0.02em]">{section.title}</h2>
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
            <QaIndicator sectionId={section.id} />
            {reviewed && <Octicon name="check-circle-fill" size={15} className="text-added" />}
          </span>
        </div>

        <div className="section-body">
          {section.related !== undefined && section.related.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {section.related.map((ref) => (
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

export function WalkthroughHeader({ headDistance }: { headDistance?: number }) {
  const payload = usePayload();
  return (
    <>
      <Header payload={payload} />
      <StaleBanner headDistance={headDistance ?? payload.headDistance} />
      <PersistBadge />
      <ResetBanner />
      <CompleteBanner />
      <ErrorCards errors={payload.errors.filter((error) => error.sectionId === undefined)} />
    </>
  );
}

export function WalkthroughNav() {
  const payload = usePayload();
  const { active } = useNavigation();
  return <Nav payload={payload} active={active} />;
}

export function WalkthroughSections() {
  const payload = usePayload();
  const { titles, errorsBySection } = useMemo(() => {
    const titles = new Map(payload.sections.map((section) => [section.id, section.title]));
    const errorsBySection = new Map<string, ErrorCard[]>();
    for (const error of payload.errors) {
      if (error.sectionId === undefined) continue;
      const list = errorsBySection.get(error.sectionId) ?? [];
      list.push(error);
      errorsBySection.set(error.sectionId, list);
    }
    return { titles, errorsBySection };
  }, [payload]);
  return (
    <div className="sections-rail mt-10">
      {payload.sections.map((section) => (
        <SectionView
          key={section.id}
          section={section}
          errors={errorsBySection.get(section.id) ?? []}
          titles={titles}
        />
      ))}
    </div>
  );
}
