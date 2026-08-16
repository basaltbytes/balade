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
import { askQa, fetchQa, fetchQaAgentStatus } from "../data/qa";
import { runAppEffect } from "../data/runtime";

interface QaApi {
  readonly available: boolean;
  readonly state: QaState;
  readonly agent: QaAgentState;
  readonly submission: QaSubmissionState;
  readonly failure: QaFailureState;
  readonly panel: QaPanelState;
  readonly threadsFor: (sectionId: string) => readonly QaThread[];
  readonly openSection: (sectionId: string) => void;
  readonly openThread: (sectionId: string, threadId: QaThread["id"]) => void;
  readonly openComposer: (anchor: QaAnchor) => void;
  readonly close: () => void;
  readonly ask: (request: QaAskRequest) => void;
}

type QaAgentState =
  | { readonly _tag: "Unchecked" }
  | { readonly _tag: "Checking" }
  | { readonly _tag: "Ready" }
  | { readonly _tag: "SetupRequired" }
  | { readonly _tag: "Unavailable" };

type QaSubmissionState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Asking" }
  | { readonly _tag: "SettingUp" };

type QaFailureState =
  | { readonly _tag: "None" }
  | { readonly _tag: "RequestFailed" }
  | { readonly _tag: "SetupFailed" };

type QaPanelState =
  | { readonly _tag: "Closed" }
  | { readonly _tag: "Section"; readonly sectionId: string }
  | {
      readonly _tag: "Thread";
      readonly sectionId: string;
      readonly threadId: QaThread["id"];
    }
  | { readonly _tag: "Composer"; readonly anchor: QaAnchor };

const CLOSED_PANEL: QaPanelState = { _tag: "Closed" };
const UNCHECKED_AGENT: QaAgentState = { _tag: "Unchecked" };
const CHECKING_AGENT: QaAgentState = { _tag: "Checking" };
const IDLE_SUBMISSION: QaSubmissionState = { _tag: "Idle" };
const NO_FAILURE: QaFailureState = { _tag: "None" };

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
  const [agent, setAgent] = useState<QaAgentState>(UNCHECKED_AGENT);
  const [submission, setSubmission] = useState<QaSubmissionState>(IDLE_SUBMISSION);
  const [failure, setFailure] = useState<QaFailureState>(NO_FAILURE);
  const [panel, setPanel] = useState<QaPanelState>(CLOSED_PANEL);
  const lifecycle = useRef<AbortController | null>(null);

  useEffect(() => {
    setState(emptyState(payload));
    setAgent(UNCHECKED_AGENT);
    setSubmission(IDLE_SUBMISSION);
    setFailure(NO_FAILURE);
    setPanel(CLOSED_PANEL);
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
            setFailure((current) => (current._tag === "RequestFailed" ? NO_FAILURE : current));
          } else {
            setFailure((current) =>
              current._tag === "SetupFailed" ? current : { _tag: "RequestFailed" },
            );
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

  const checkAgent = useCallback(() => {
    const scope = lifecycle.current;
    if (
      !served ||
      scope === null ||
      agent._tag === "Checking" ||
      agent._tag === "Ready" ||
      agent._tag === "SetupRequired"
    ) {
      return;
    }
    setAgent(CHECKING_AGENT);
    runAppEffect(
      fetchQaAgentStatus().pipe(
        Effect.match({
          onFailure: () => ({ _tag: "Unavailable" as const }),
          onSuccess: (status) =>
            status.status === "ready"
              ? { _tag: "Ready" as const }
              : { _tag: "SetupRequired" as const },
        }),
      ),
      (next) => {
        if (!scope.signal.aborted) setAgent(next);
      },
      { signal: scope.signal },
    );
  }, [agent._tag, served]);

  const openSection = useCallback(
    (sectionId: string) => {
      checkAgent();
      setPanel({ _tag: "Section", sectionId });
    },
    [checkAgent],
  );

  const openThread = useCallback(
    (sectionId: string, threadId: QaThread["id"]) => {
      checkAgent();
      setPanel({ _tag: "Thread", sectionId, threadId });
    },
    [checkAgent],
  );

  const openComposer = useCallback(
    (anchor: QaAnchor) => {
      checkAgent();
      setPanel({ _tag: "Composer", anchor });
    },
    [checkAgent],
  );

  const ask = useCallback(
    (request: QaAskRequest) => {
      const scope = lifecycle.current;
      if (!served || submission._tag !== "Idle" || scope === null) return;
      const needsSetup = agent._tag === "SetupRequired";
      setSubmission(needsSetup ? { _tag: "SettingUp" } : { _tag: "Asking" });
      setFailure(NO_FAILURE);
      runAppEffect(
        askQa(payload.sourcePath, request).pipe(
          Effect.match({
            onFailure: () => ({ ok: false as const }),
            onSuccess: (next) => ({ ok: true as const, next }),
          }),
        ),
        (outcome) => {
          if (scope.signal.aborted) return;
          setSubmission(IDLE_SUBMISSION);
          if (outcome.ok) {
            setAgent({ _tag: "Ready" });
            setState(outcome.next);
            setPanel((current) =>
              request.kind === "new" &&
              current._tag === "Composer" &&
              current.anchor === request.anchor
                ? { _tag: "Section", sectionId: request.anchor.sectionId }
                : current,
            );
          } else {
            setFailure(needsSetup ? { _tag: "SetupFailed" } : { _tag: "RequestFailed" });
          }
        },
        { signal: scope.signal },
      );
    },
    [agent, payload.sourcePath, served, submission],
  );

  const value = useMemo<QaApi>(
    () => ({
      available: served,
      state,
      agent,
      submission,
      failure,
      panel,
      threadsFor: (sectionId) =>
        state.threads.filter((thread) => thread.anchor.sectionId === sectionId),
      openSection,
      openThread,
      openComposer,
      close: () => setPanel(CLOSED_PANEL),
      ask,
    }),
    [agent, ask, failure, openComposer, openSection, openThread, panel, served, state, submission],
  );

  return <QaContext.Provider value={value}>{children}</QaContext.Provider>;
}

export function useQa(): QaApi {
  const value = useContext(QaContext);
  if (value === null) throw new Error("useQa must be inside QaProvider");
  return value;
}
