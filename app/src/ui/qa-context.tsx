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
  readonly request: QaRequestState;
  readonly failure: QaFailureState;
  readonly panel: QaPanelState;
  readonly threadsFor: (sectionId: string) => readonly QaThread[];
  readonly openSection: (sectionId: string) => void;
  readonly openThread: (sectionId: string, threadId: QaThread["id"]) => void;
  readonly openComposer: (anchor: QaAnchor) => void;
  readonly close: () => void;
  readonly ask: (request: QaAskIntent) => void;
}

type QaAskIntent =
  | { readonly kind: "new"; readonly anchor: QaAnchor; readonly question: string }
  | { readonly kind: "follow-up"; readonly threadId: QaThread["id"]; readonly question: string };

type QaAgentState =
  | { readonly _tag: "Unchecked" }
  | { readonly _tag: "Checking" }
  | { readonly _tag: "Ready" }
  | { readonly _tag: "SetupRequired" }
  | { readonly _tag: "Unavailable" };

type QaRequestState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Asking" }
  | { readonly _tag: "SettingUp" }
  | { readonly _tag: "RequestFailed" }
  | { readonly _tag: "SetupFailed" }
  | { readonly _tag: "GenerationChanged" };

type QaPollState = { readonly _tag: "Current" } | { readonly _tag: "Unavailable" };

type QaFailureState =
  | { readonly _tag: "None" }
  | { readonly _tag: "Unavailable" }
  | { readonly _tag: "SetupFailed" }
  | { readonly _tag: "GenerationChanged" };

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
const IDLE_REQUEST: QaRequestState = { _tag: "Idle" };
const CURRENT_POLL: QaPollState = { _tag: "Current" };

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
  const [requestState, setRequest] = useState<QaRequestState>(IDLE_REQUEST);
  const [pollState, setPollState] = useState<QaPollState>(CURRENT_POLL);
  const [panel, setPanel] = useState<QaPanelState>(CLOSED_PANEL);
  const lifecycle = useRef<AbortController | null>(null);
  const pollEpoch = useRef(0);
  const requestPending = useRef(false);

  useEffect(() => {
    setState(emptyState(payload));
    setAgent(UNCHECKED_AGENT);
    setRequest(IDLE_REQUEST);
    setPollState(CURRENT_POLL);
    setPanel(CLOSED_PANEL);
    lifecycle.current = null;
    pollEpoch.current += 1;
    requestPending.current = false;
    if (!served) return;

    const scope = new AbortController();
    lifecycle.current = scope;
    let timer: number | undefined;
    const poll = (): void => {
      if (requestPending.current) {
        timer = window.setTimeout(poll, 1_500);
        return;
      }
      const epoch = pollEpoch.current;
      runAppEffect(
        fetchQa(payload.sourcePath).pipe(
          Effect.match({
            onFailure: () => ({ ok: false as const }),
            onSuccess: (next) => ({ ok: true as const, next }),
          }),
        ),
        (outcome) => {
          if (scope.signal.aborted) return;
          if (epoch === pollEpoch.current && !requestPending.current) {
            if (outcome.ok) {
              setState(outcome.next);
              setPollState(CURRENT_POLL);
            } else {
              setPollState({ _tag: "Unavailable" });
            }
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
    (request: QaAskIntent) => {
      const scope = lifecycle.current;
      if (!served || isRequestPending(requestState) || requestPending.current || scope === null) {
        return;
      }
      const needsSetup = agent._tag === "SetupRequired";
      requestPending.current = true;
      pollEpoch.current += 1;
      setRequest(needsSetup ? { _tag: "SettingUp" } : { _tag: "Asking" });
      const submitted = {
        ...request,
        generation: { pr: payload.pr.number, stamp: payload.commit },
      } satisfies QaAskRequest;
      runAppEffect(
        askQa(payload.sourcePath, submitted).pipe(
          Effect.match({
            onFailure: (error) => ({ ok: false as const, error }),
            onSuccess: (next) => ({ ok: true as const, next }),
          }),
        ),
        (outcome) => {
          if (scope.signal.aborted) return;
          requestPending.current = false;
          if (outcome.ok) {
            setRequest(IDLE_REQUEST);
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
            if (outcome.error._tag === "QaAgentUnavailable") {
              setAgent({ _tag: "SetupRequired" });
              setRequest({ _tag: "SetupFailed" });
            } else {
              setRequest(
                outcome.error._tag === "QaGenerationChanged"
                  ? { _tag: "GenerationChanged" }
                  : { _tag: "RequestFailed" },
              );
            }
          }
        },
        { signal: scope.signal },
      );
    },
    [agent, payload.commit, payload.pr.number, payload.sourcePath, requestState, served],
  );

  const value = useMemo<QaApi>(
    () => ({
      available: served,
      state,
      agent,
      request: requestState,
      failure: qaFailure(requestState, pollState),
      panel,
      threadsFor: (sectionId) =>
        state.threads.filter((thread) => thread.anchor.sectionId === sectionId),
      openSection,
      openThread,
      openComposer,
      close: () => setPanel(CLOSED_PANEL),
      ask,
    }),
    [
      agent,
      ask,
      openComposer,
      openSection,
      openThread,
      panel,
      pollState,
      requestState,
      served,
      state,
    ],
  );

  return <QaContext.Provider value={value}>{children}</QaContext.Provider>;
}

function isRequestPending(state: QaRequestState): boolean {
  return state._tag === "Asking" || state._tag === "SettingUp";
}

function qaFailure(request: QaRequestState, poll: QaPollState): QaFailureState {
  if (request._tag === "SetupFailed") return { _tag: "SetupFailed" };
  if (request._tag === "GenerationChanged") return { _tag: "GenerationChanged" };
  return request._tag === "RequestFailed" || poll._tag === "Unavailable"
    ? { _tag: "Unavailable" }
    : { _tag: "None" };
}

export function useQa(): QaApi {
  const value = useContext(QaContext);
  if (value === null) throw new Error("useQa must be inside QaProvider");
  return value;
}
