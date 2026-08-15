/** Served Q&A state, polling, and UI actions for one walkthrough generation. */

import { Effect } from "effect";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
  readonly composer: QaAnchor | null;
  readonly threadsFor: (sectionId: string) => readonly QaThread[];
  readonly openSection: (sectionId: string) => void;
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
  const [composer, setComposer] = useState<QaAnchor | null>(null);

  useEffect(() => {
    setState(emptyState(payload));
    setFailed(false);
    if (!served) return;

    let timer: number | undefined;
    let interrupt = (): void => undefined;
    let stopped = false;
    const poll = (): void => {
      interrupt = runAppEffect(
        fetchQa(payload.sourcePath).pipe(
          Effect.match({
            onFailure: () => ({ ok: false as const }),
            onSuccess: (next) => ({ ok: true as const, next }),
          }),
        ),
        (outcome) => {
          if (stopped) return;
          if (outcome.ok) {
            setState(outcome.next);
            setFailed(false);
          } else {
            setFailed(true);
          }
          timer = window.setTimeout(poll, 1_500);
        },
      );
    };
    poll();
    return () => {
      stopped = true;
      interrupt();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [payload, served]);

  const ask = useCallback(
    (request: QaAskRequest) => {
      if (!served || submitting) return;
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
          setSubmitting(false);
          if (outcome.ok) {
            setState(outcome.next);
            setComposer(null);
          } else {
            setFailed(true);
          }
        },
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
      composer,
      threadsFor: (sectionId) =>
        state.threads.filter((thread) => thread.anchor.sectionId === sectionId),
      openSection: (sectionId) => {
        setActiveSectionId(sectionId);
        setComposer(null);
      },
      openComposer: (anchor) => {
        setActiveSectionId(anchor.sectionId);
        setComposer(anchor);
      },
      close: () => {
        setActiveSectionId(null);
        setComposer(null);
      },
      ask,
    }),
    [activeSectionId, ask, composer, failed, served, state, submitting],
  );

  return <QaContext.Provider value={value}>{children}</QaContext.Provider>;
}

export function useQa(): QaApi {
  const value = useContext(QaContext);
  if (value === null) throw new Error("useQa must be inside QaProvider");
  return value;
}
