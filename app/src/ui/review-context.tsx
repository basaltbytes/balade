/* The React face of the review state: one hook that owns it, one context so a
   files browser deep in a section can flip its own "Viewed" box. */

import { Option } from "effect";
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
import { runAppEffect } from "../data/runtime";
import { loadReview, saveReview, type ReviewStoreTarget, type SaveOutcome } from "../data/store";

export interface ReviewApi {
  /** Marks stay read-only until stored state has been reconciled. */
  ready: boolean;
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

export function useReviewApi(payload: Payload, target: ReviewStoreTarget): ReviewApi {
  const [state, setState] = useState<ReviewState>(() => emptyState(payload));
  const [reset, setReset] = useState<ResetReport | null>(null);
  const [persist, setPersist] = useState<SaveOutcome>("saved");
  const [hideReviewed, setHideReviewed] = useState(false);
  const current = useRef(state);
  const hydratedPayload = useRef<Payload | null>(null);
  const hydratedTarget = useRef<ReviewStoreTarget | null>(null);
  const saveScope = useRef<AbortController | null>(null);
  const ready = hydratedPayload.current === payload && hydratedTarget.current === target;

  const persistState = useCallback(
    (next: ReviewState) => {
      const scope = saveScope.current;
      if (scope === null) return;
      runAppEffect(
        saveReview(target, next),
        (outcome) => {
          if (!scope.signal.aborted) setPersist(outcome);
        },
        { signal: scope.signal },
      );
    },
    [target],
  );

  useEffect(() => {
    hydratedPayload.current = null;
    hydratedTarget.current = null;
    const initial = emptyState(payload);
    current.current = initial;
    setState(initial);
    setReset(null);
    setPersist("saved");

    const scope = new AbortController();
    saveScope.current = scope;
    const cancelLoad = runAppEffect(loadReview(target), (storedOption) => {
      const stored = Option.getOrNull(storedOption);
      const outcome = reconcile(payload, stored);
      hydratedPayload.current = payload;
      hydratedTarget.current = target;
      const next = outcome.state;
      current.current = next;
      setState(next);
      if (outcome.reset.sections.length > 0 || outcome.reset.files.length > 0) {
        setReset(outcome.reset);
      }
      if (outcome.changed) persistState(next);
    });
    return () => {
      if (hydratedPayload.current === payload) hydratedPayload.current = null;
      if (hydratedTarget.current === target) hydratedTarget.current = null;
      cancelLoad();
      scope.abort();
      if (saveScope.current === scope) saveScope.current = null;
    };
  }, [payload, persistState, target]);

  const update = useCallback(
    (next: (previous: ReviewState) => ReviewState) => {
      if (hydratedPayload.current !== payload || hydratedTarget.current !== target) return;
      const updated = next(current.current);
      if (updated === current.current) return;
      current.current = updated;
      setState(updated);
      persistState(updated);
    },
    [payload, persistState, target],
  );

  return useMemo<ReviewApi>(
    () => ({
      ready,
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
    [payload, ready, state, reset, persist, hideReviewed, update],
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
