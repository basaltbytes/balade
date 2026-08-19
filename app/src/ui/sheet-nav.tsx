/* The compact viewport's navigation. Below `md` the sidebar has nowhere to go,
   so its two jobs split: position and onward motion live in a thumb-reachable
   bottom bar that is always on screen, and the full tree — progress, the
   review toggles, clarifications, every section and file — opens as a sheet
   from that bar. Nothing the wide layout offers is unreachable here. */

import { useEffect, useState } from "react";
import type { Payload } from "../contract";
import { ProgressBar } from "./bits";
import { jumpTo, Nav } from "./nav";
import { Octicon } from "./octicon";
import { useReview } from "./review-context";
import { useStrings } from "./strings";

/** The sheet owns the scroll while it is up; the document behind it must not move. */
function useScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previous;
    };
  }, [locked]);
}

function SectionSheet({
  payload,
  active,
  onClose,
}: {
  payload: Payload;
  active: string;
  onClose: () => void;
}) {
  const strings = useStrings();
  useScrollLock(true);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 md:hidden" data-section-sheet>
      <button
        type="button"
        aria-label={strings.sheet.close}
        onClick={onClose}
        className="absolute inset-0 bg-black/50 cursor-default"
      />
      <aside className="absolute inset-x-0 bottom-0 max-h-[82vh] overflow-y-auto rounded-t-2xl border-t border-border bg-background pb-[max(16px,env(safe-area-inset-bottom))]">
        <div className="sticky top-0 z-10 bg-background pt-2.5">
          <span className="mx-auto block h-1 w-9 rounded-full bg-border" aria-hidden="true" />
          <button
            type="button"
            onClick={onClose}
            aria-label={strings.sheet.close}
            className="absolute right-3 top-2 inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
          >
            <Octicon name="x" size={18} />
          </button>
        </div>
        <div
          className="px-4 pt-4"
          /* Any jump inside the tree has done its job the moment it scrolls;
             leaving the sheet up would hide what the reader asked to see. */
          onClick={(event) => {
            if (event.target instanceof Element && event.target.closest("a") !== null) onClose();
          }}
        >
          <Nav payload={payload} active={active} />
        </div>
      </aside>
    </div>
  );
}

export function SheetNav({ payload, active }: { payload: Payload; active: string }) {
  const strings = useStrings();
  const review = useReview();
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background md:hidden">
        <ProgressBar
          done={review.progress.done}
          total={review.progress.total}
          className="absolute inset-x-0 -top-px rounded-none"
        />
        <div className="flex items-center gap-3 px-3 pt-2 pb-[max(8px,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-expanded={open}
            className="inline-flex min-h-11 flex-1 items-center gap-2.5 rounded-md px-2 text-[13px] text-secondary-foreground cursor-pointer hover:text-foreground"
          >
            <Octicon name="list-unordered" size={16} className="shrink-0" />
            {strings.sheet.open}
            <span className="tabular-nums text-muted-foreground">
              {review.progress.done}/{review.progress.total}
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              const next = review.next(active === "" ? undefined : active);
              if (next) jumpTo(next);
            }}
            disabled={review.complete}
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-[13px] text-secondary-foreground cursor-pointer hover:border-primary hover:text-foreground disabled:opacity-40 disabled:hover:border-border disabled:cursor-default"
          >
            <Octicon name="arrow-right" size={14} />
            {strings.nextUnreviewed}
          </button>
        </div>
      </div>
      {open && <SectionSheet payload={payload} active={active} onClose={() => setOpen(false)} />}
    </>
  );
}
