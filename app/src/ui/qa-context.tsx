/** Served Q&A state, polling, and UI actions for one walkthrough generation. */

import { Effect } from "effect";
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
import type { Payload, QaAnchor, QaAskRequest, QaState, QaThread } from "../contract";
import { askQa, fetchQa } from "../data/qa";
import { runAppEffect } from "../data/runtime";

interface QaApi {
  readonly available: boolean;
  readonly state: QaState;
  readonly submitting: boolean;
  readonly failed: boolean;
  readonly activeSectionId: string | null;
  readonly activeThreadId: QaThread["id"] | null;
  readonly composer: QaAnchor | null;
  readonly threadsFor: (sectionId: string) => readonly QaThread[];
  readonly openSection: (sectionId: string) => void;
  readonly openThread: (sectionId: string, threadId: QaThread["id"]) => void;
  readonly openComposer: (anchor: QaAnchor) => void;
  readonly close: () => void;
  readonly ask: (request: QaAskRequest) => void;
}

const QaContext = createContext<QaApi | null>(null);

function emptyState(payload: Payload): QaState {
  return {
    version: 1,
    walkthrough: payload.sourcePath,
    pr: payload.pr.number,
    stamp: payload.commit,
    threads: [],
  };
}

export function QaProvider({
  payload,
  served,
  children,
}: {
  payload: Payload;
  served: boolean;
  children: ReactNode;
}) {
  const [state, setState] = useState<QaState>(() => emptyState(payload));
  const [failed, setFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<QaThread["id"] | null>(null);
  const [composer, setComposer] = useState<QaAnchor | null>(null);
  const lifecycle = useRef<AbortController | null>(null);

  useEffect(() => {
    setState(emptyState(payload));
    setFailed(false);
    setSubmitting(false);
    setActiveSectionId(null);
    setActiveThreadId(null);
    setComposer(null);
    lifecycle.current = null;
    if (!served) return;

    const scope = new AbortController();
    lifecycle.current = scope;
    let timer: number | undefined;
    const poll = (): void => {
      runAppEffect(
        fetchQa(payload.sourcePath).pipe(
          Effect.match({
            onFailure: () => ({ ok: false as const }),
            onSuccess: (next) => ({ ok: true as const, next }),
          }),
        ),
        (outcome) => {
          if (scope.signal.aborted) return;
          if (outcome.ok) {
            setState(outcome.next);
            setFailed(false);
          } else {
            setFailed(true);
          }
          timer = window.setTimeout(poll, 1_500);
        },
        { signal: scope.signal },
      );
    };
    poll();
    return () => {
      scope.abort();
      if (lifecycle.current === scope) lifecycle.current = null;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [payload, served]);

  const ask = useCallback(
    (request: QaAskRequest) => {
      const scope = lifecycle.current;
      if (!served || submitting || scope === null) return;
      setSubmitting(true);
      setFailed(false);
      runAppEffect(
        askQa(payload.sourcePath, request).pipe(
          Effect.match({
            onFailure: () => ({ ok: false as const }),
            onSuccess: (next) => ({ ok: true as const, next }),
          }),
        ),
        (outcome) => {
          if (scope.signal.aborted) return;
          setSubmitting(false);
          if (outcome.ok) {
            setState(outcome.next);
            setComposer(null);
          } else {
            setFailed(true);
          }
        },
        { signal: scope.signal },
      );
    },
    [payload.sourcePath, served, submitting],
  );

  const value = useMemo<QaApi>(
    () => ({
      available: served,
      state,
      submitting,
      failed,
      activeSectionId,
      activeThreadId,
      composer,
      threadsFor: (sectionId) =>
        state.threads.filter((thread) => thread.anchor.sectionId === sectionId),
      openSection: (sectionId) => {
        setActiveSectionId(sectionId);
        setActiveThreadId(null);
        setComposer(null);
      },
      openThread: (sectionId, threadId) => {
        setActiveSectionId(sectionId);
        setActiveThreadId(threadId);
        setComposer(null);
      },
      openComposer: (anchor) => {
        setActiveSectionId(anchor.sectionId);
        setActiveThreadId(null);
        setComposer(anchor);
      },
      close: () => {
        setActiveSectionId(null);
        setActiveThreadId(null);
        setComposer(null);
      },
      ask,
    }),
    [activeSectionId, activeThreadId, ask, composer, failed, served, state, submitting],
  );

  return <QaContext.Provider value={value}>{children}</QaContext.Provider>;
}

export function useQa(): QaApi {
  const value = useContext(QaContext);
  if (value === null) throw new Error("useQa must be inside QaProvider");
  return value;
}
