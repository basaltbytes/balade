/* The React face of the review state: one hook that owns it, one context so a
   files browser deep in a section can flip its own "Viewed" box. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Payload, ReviewState, Section } from "../contract";
import {
  emptyState,
  fileProgress,
  isComplete,
  isFileViewed,
  isSectionReviewed,
  nextUnreviewed,
  reconcile,
  sectionProgress,
  toggleFile,
  toggleSection,
  type Progress,
  type ResetReport,
} from "../data/review";
import type { ReviewStore, SaveOutcome } from "../data/store";

export interface ReviewApi {
  state: ReviewState;
  progress: Progress;
  complete: boolean;
  reset: ResetReport | null;
  dismissReset: () => void;
  /** Outcome of the last write; anything but `"saved"` raises the persistence badge. */
  persist: SaveOutcome;
  hideReviewed: boolean;
  setHideReviewed: (value: boolean) => void;
  sectionReviewed: (sectionId: string) => boolean;
  fileViewed: (sectionId: string, path: string) => boolean;
  markSection: (sectionId: string) => void;
  markFile: (sectionId: string, path: string) => void;
  filesOf: (section: Section) => Progress | null;
  next: (afterId?: string) => string | null;
}

export function useReviewApi(payload: Payload, store: ReviewStore): ReviewApi {
  const [state, setState] = useState<ReviewState>(() => emptyState(payload));
  const [reset, setReset] = useState<ResetReport | null>(null);
  const [persist, setPersist] = useState<SaveOutcome>("saved");
  const [hideReviewed, setHideReviewed] = useState(false);
  const dirty = useRef(false);

  useEffect(() => {
    let alive = true;
    void store.load().then((stored) => {
      if (!alive) return;
      const outcome = reconcile(payload, stored);
      setState(outcome.state);
      if (outcome.reset.sections.length > 0 || outcome.reset.files.length > 0) {
        setReset(outcome.reset);
      }
      if (outcome.changed) {
        void store.save(outcome.state).then((saved) => {
          if (alive) setPersist(saved);
        });
      }
    });
    return () => {
      alive = false;
    };
  }, [payload, store]);

  useEffect(() => {
    if (!dirty.current) return;
    dirty.current = false;
    let alive = true;
    void store.save(state).then((saved) => {
      if (alive) setPersist(saved);
    });
    return () => {
      alive = false;
    };
  }, [state, store]);

  const update = useCallback((next: (previous: ReviewState) => ReviewState) => {
    dirty.current = true;
    setState(next);
  }, []);

  return useMemo<ReviewApi>(
    () => ({
      state,
      progress: sectionProgress(payload, state),
      complete: isComplete(payload, state),
      reset,
      dismissReset: () => setReset(null),
      persist,
      hideReviewed,
      setHideReviewed,
      sectionReviewed: (sectionId) => isSectionReviewed(state, sectionId),
      fileViewed: (sectionId, path) => isFileViewed(state, sectionId, path),
      markSection: (sectionId) =>
        update((previous) => toggleSection(payload, previous, sectionId, new Date().toISOString())),
      markFile: (sectionId, path) =>
        update((previous) =>
          toggleFile(payload, previous, sectionId, path, new Date().toISOString()),
        ),
      filesOf: (section) => fileProgress(payload, state, section),
      next: (afterId) => nextUnreviewed(payload, state, afterId),
    }),
    [payload, state, reset, persist, hideReviewed, update],
  );
}

const ReviewContext = createContext<ReviewApi | null>(null);

export function ReviewProvider({ value, children }: { value: ReviewApi; children: ReactNode }) {
  return <ReviewContext.Provider value={value}>{children}</ReviewContext.Provider>;
}

export function useReview(): ReviewApi {
  const api = useContext(ReviewContext);
  if (!api) throw new Error("useReview outside a ReviewProvider");
  return api;
}

const SectionContext = createContext<string>("");

export function SectionProvider({ id, children }: { id: string; children: ReactNode }) {
  return <SectionContext.Provider value={id}>{children}</SectionContext.Provider>;
}

export const useSectionId = (): string => useContext(SectionContext);
