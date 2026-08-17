/** Owned generation states and timing, independent of terminal policy. */

import type { AuthorOutput, AuthorProgress, AuthorUsage } from "../../pi/author.js";

export type GenerationStatus =
  | { readonly _tag: "PreparingGeneration" }
  | { readonly _tag: "AuthoringGeneration"; readonly turn: number }
  | { readonly _tag: "RunningAuthorTool"; readonly turn: number; readonly name: string }
  | { readonly _tag: "CheckingGeneration"; readonly pass: number }
  | {
      readonly _tag: "RepairingGeneration";
      readonly attempt: number;
      readonly maximumAttempts: number;
    };

export interface GenerationStatusChanged {
  readonly _tag: "GenerationStatusChanged";
  readonly status: GenerationStatus;
}

export interface GenerationTurnCompleted {
  readonly _tag: "GenerationTurnCompleted";
  readonly turn: number;
  readonly usage: AuthorUsage;
}

type AuthorDisplayOutput = Exclude<AuthorOutput, { readonly _tag: "AuthorUsageUpdated" }>;

export type GenerationProgress =
  | AuthorDisplayOutput
  | GenerationStatusChanged
  | GenerationTurnCompleted;

export type GenerationTimingSegment =
  | { readonly _tag: "PreparationTiming"; readonly milliseconds: number }
  | { readonly _tag: "AuthorTurnTiming"; readonly turn: number; readonly milliseconds: number }
  | { readonly _tag: "CheckTiming"; readonly pass: number; readonly milliseconds: number };

export interface GenerationTiming {
  readonly totalMilliseconds: number;
  readonly segments: readonly GenerationTimingSegment[];
}

export interface GenerationProgressReporter {
  readonly author: (event: AuthorProgress) => void;
  readonly checking: (pass: number) => void;
  readonly repairing: (attempt: number, maximumAttempts: number) => void;
  readonly finish: () => GenerationTiming;
}

/**
 * The pipeline owns the generation lifecycle. Pi supplies only its current
 * author state; this reporter places that state inside the active generation
 * turn and records time against the resulting explicit state machine.
 */
export function makeGenerationProgressReporter(
  progress: (event: GenerationProgress) => void,
  monotonicNow: () => number,
): GenerationProgressReporter {
  let authoring: AuthoringStatus = { _tag: "AuthoringGeneration", turn: 1 };
  let current: GenerationStatus = { _tag: "PreparingGeneration" };
  const totalStartedAt = monotonicNow();
  let currentSince = totalStartedAt;
  const segments = new Map<string, GenerationTimingSegment>();
  progress({ _tag: "GenerationStatusChanged", status: current });

  const addElapsed = (status: GenerationStatus, milliseconds: number) => {
    const next = timingSegment(status, milliseconds);
    const key = timingSegmentKey(next);
    const previous = segments.get(key);
    segments.set(key, previous === undefined ? next : addTiming(previous, milliseconds));
  };

  const transition = (status: GenerationStatus) => {
    if (sameStatus(current, status)) return;
    const changedAt = monotonicNow();
    addElapsed(current, changedAt - currentSince);
    current = status;
    currentSince = changedAt;
    progress({ _tag: "GenerationStatusChanged", status });
  };

  const author = (event: AuthorProgress) => {
    switch (event._tag) {
      case "AuthorStatusChanged":
        switch (event.status._tag) {
          case "AuthorGenerating":
            transition(authoring);
            break;
          case "AuthorUsingTool":
            transition({
              _tag: "RunningAuthorTool",
              turn: authoringTurn(authoring),
              name: event.status.name,
            });
            break;
        }
        break;
      case "AuthorNotice":
      case "AuthorAssistantText":
      case "AuthorToolStarted":
      case "AuthorToolFinished":
        progress(event);
        break;
      case "AuthorUsageUpdated":
        progress({
          _tag: "GenerationTurnCompleted",
          turn: authoringTurn(authoring),
          usage: event.usage,
        });
        break;
    }
  };

  return {
    author,
    checking: (pass) => transition({ _tag: "CheckingGeneration", pass }),
    repairing: (attempt, maximumAttempts) => {
      authoring = { _tag: "RepairingGeneration", attempt, maximumAttempts };
      transition(authoring);
    },
    finish: () => {
      const completedAt = monotonicNow();
      addElapsed(current, completedAt - currentSince);
      currentSince = completedAt;
      return {
        totalMilliseconds: completedAt - totalStartedAt,
        segments: [...segments.values()],
      };
    },
  };
}

type AuthoringStatus = Extract<
  GenerationStatus,
  { readonly _tag: "AuthoringGeneration" | "RepairingGeneration" }
>;

function authoringTurn(status: AuthoringStatus): number {
  switch (status._tag) {
    case "AuthoringGeneration":
      return status.turn;
    case "RepairingGeneration":
      return status.attempt + 1;
  }
}

function sameStatus(left: GenerationStatus, right: GenerationStatus): boolean {
  if (left._tag !== right._tag) return false;
  switch (left._tag) {
    case "PreparingGeneration":
      return true;
    case "AuthoringGeneration":
      return right._tag === "AuthoringGeneration" && left.turn === right.turn;
    case "RunningAuthorTool":
      return (
        right._tag === "RunningAuthorTool" && left.turn === right.turn && left.name === right.name
      );
    case "CheckingGeneration":
      return right._tag === "CheckingGeneration" && left.pass === right.pass;
    case "RepairingGeneration":
      return (
        right._tag === "RepairingGeneration" &&
        left.attempt === right.attempt &&
        left.maximumAttempts === right.maximumAttempts
      );
  }
}

function timingSegment(status: GenerationStatus, milliseconds: number): GenerationTimingSegment {
  switch (status._tag) {
    case "PreparingGeneration":
      return { _tag: "PreparationTiming", milliseconds };
    case "AuthoringGeneration":
    case "RunningAuthorTool":
      return { _tag: "AuthorTurnTiming", turn: status.turn, milliseconds };
    case "CheckingGeneration":
      return { _tag: "CheckTiming", pass: status.pass, milliseconds };
    case "RepairingGeneration":
      return { _tag: "AuthorTurnTiming", turn: status.attempt + 1, milliseconds };
  }
}

function timingSegmentKey(segment: GenerationTimingSegment): string {
  switch (segment._tag) {
    case "PreparationTiming":
      return "preparation";
    case "AuthorTurnTiming":
      return `turn:${segment.turn}`;
    case "CheckTiming":
      return `check:${segment.pass}`;
  }
}

function addTiming(
  segment: GenerationTimingSegment,
  milliseconds: number,
): GenerationTimingSegment {
  return { ...segment, milliseconds: segment.milliseconds + milliseconds };
}
