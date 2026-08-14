/* Page chrome: the PR header, the staleness banner, the soft-open error cards,
   the hash-reset banner and the review-complete state. */

import type { ErrorCard, Payload } from "../contract";
import { Banner, Chip } from "./bits";
import { Octicon } from "./octicon";
import { useReview } from "./review-context";
import { useStrings } from "./strings";

const STATE_TONE = {
  open: "bg-open text-primary-foreground border-open",
  merged: "bg-done/20 text-done border-done/40",
  closed: "bg-destructive/15 text-destructive border-destructive/40",
} satisfies Record<Payload["pr"]["state"], string>;

const STATE_ICON = {
  open: "git-pull-request",
  merged: "git-merge",
  closed: "x",
} satisfies Record<Payload["pr"]["state"], string>;

export function Header({ payload }: { payload: Payload }) {
  const strings = useStrings();
  const { pr } = payload;
  return (
    <header className="mb-8">
      <div className="flex items-center flex-wrap gap-2 mb-2">
        <Octicon
          name={STATE_ICON[pr.state]}
          size={18}
          className={pr.state === "open" ? "text-open" : "text-done"}
        />
        <h1 className="text-[22px] font-semibold">
          {payload.title}{" "}
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground font-normal hover:text-primary"
          >
            #{pr.number}
          </a>
        </h1>
      </div>
      <div className="flex items-center flex-wrap gap-2 text-[13px] text-muted-foreground">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-3 py-[3px] text-[12px] font-medium ${STATE_TONE[pr.state]}`}
        >
          <Octicon name={STATE_ICON[pr.state]} size={13} />
          {strings.prState[pr.state]}
        </span>
        <span>
          <b className="text-secondary-foreground">{pr.author}</b>{" "}
          {strings.wantsToMerge(pr.commits, pr.base, pr.head)}
        </span>
      </div>
      <div className="flex items-center flex-wrap gap-x-4 gap-y-2 mt-3 text-[12.5px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Octicon name="file-diff" size={14} />
          {strings.filesChanged(pr.stats.files)}
        </span>
        <span className="font-mono">
          <span className="text-added">+{pr.stats.additions}</span>{" "}
          <span className="text-removed">−{pr.stats.deletions}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Octicon name="git-commit" size={14} />
          {strings.pinnedAt}{" "}
          <span className="font-mono text-accent-muted">{payload.commit.slice(0, 10)}</span>
        </span>
        {Object.entries(payload.meta).map(([key, value]) => (
          <Chip key={key}>
            {key}={value}
          </Chip>
        ))}
        {payload.preset !== undefined && <Chip tone="done">preset: {payload.preset}</Chip>}
      </div>
    </header>
  );
}

export function StaleBanner({ headDistance }: { headDistance: number }) {
  const strings = useStrings();
  if (headDistance <= 0) return null;
  return (
    <Banner tone="warn" icon="alert" title={strings.headMovedTitle(headDistance)}>
      {strings.headMovedBody}
    </Banner>
  );
}

export function ErrorCards({ errors }: { errors: ErrorCard[] }) {
  const strings = useStrings();
  if (errors.length === 0) return null;
  return (
    <div className="my-4">
      <div className="text-[13px] font-semibold text-destructive mb-2 inline-flex items-center gap-2">
        <Octicon name="alert" size={14} />
        {strings.errorsTitle(errors.length)}
      </div>
      <div className="grid gap-2">
        {errors.map((error, index) => (
          <div
            key={`${error.code}-${index}`}
            className="border border-destructive/50 bg-destructive/10 rounded-md px-4 py-3"
          >
            <div className="flex items-center flex-wrap gap-2 mb-1">
              <span className="font-mono text-[11.5px] text-destructive">{error.code}</span>
              {error.line !== undefined && (
                <span className="font-mono text-[11.5px] text-muted-foreground">:{error.line}</span>
              )}
            </div>
            <div className="text-[13px] text-secondary-foreground leading-relaxed">
              {error.message}
            </div>
            {error.reference !== undefined && (
              <div className="mt-1 font-mono text-[11.5px] text-muted-foreground">
                {strings.errorAt(error.reference)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ResetBanner() {
  const strings = useStrings();
  const review = useReview();
  if (!review.reset) return null;
  const { sections, files } = review.reset;
  return (
    <Banner tone="key" icon="info" title={strings.resetTitle} onDismiss={review.dismissReset}>
      <p>{strings.resetBody}</p>
      {sections.length > 0 && (
        <p className="mt-1">
          <b className="text-foreground">{strings.resetSections}: </b>
          {sections.join(", ")}
        </p>
      )}
      {files.length > 0 && (
        <p className="mt-1">
          <b className="text-foreground">{strings.resetFiles}: </b>
          <span className="font-mono text-[12px]">{files.join(", ")}</span>
        </p>
      )}
    </Banner>
  );
}

/** A write that did not reach the CLI is never silent: the reader sees where the marks went. */
export function PersistBadge() {
  const strings = useStrings();
  const review = useReview();
  if (review.persist === "saved") return null;
  const fallback = review.persist === "fallback";
  return (
    <div className="my-3">
      <Chip tone={fallback ? "mod" : "del"} icon="alert">
        {fallback ? strings.saveFallback : strings.saveFailed}
      </Chip>
    </div>
  );
}

export function CompleteBanner() {
  const strings = useStrings();
  const review = useReview();
  if (!review.complete) return null;
  return (
    <Banner tone="done" icon="check-circle-fill" title={strings.reviewComplete}>
      {strings.reviewCompleteBody}
    </Banner>
  );
}
