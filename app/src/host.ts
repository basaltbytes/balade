import type { QaAgentStatus, QaAskRequest, QaState, ReviewState } from "./contract";

/** Capabilities owned by the embedding application. No capability is inferred from the origin. */
export interface WalkthroughHost {
  /** Omit to keep review marks in memory. */
  readonly reviewState?: {
    load(signal: AbortSignal): Promise<ReviewState | null>;
    save(state: ReviewState, signal: AbortSignal): Promise<void>;
  };
  /** Omit to hide clarification controls. */
  readonly clarifications?: {
    status(signal: AbortSignal): Promise<QaAgentStatus>;
    load(signal: AbortSignal): Promise<QaState | null>;
    ask(request: QaAskRequest, signal: AbortSignal): Promise<QaState>;
    /** Without a subscription the viewer polls load. */
    subscribe?(onChange: (state: QaState) => void): () => void;
  };
}

/** Agent setup did not complete; the reader can try again. */
export class ClarificationAgentUnavailable extends Error {
  readonly _tag = "ClarificationAgentUnavailable";
  constructor() {
    super("The clarification agent is unavailable.");
    this.name = this._tag;
  }
}

/** The host no longer serves the generation displayed by this viewer. */
export class ClarificationGenerationChanged extends Error {
  readonly _tag = "ClarificationGenerationChanged";
  constructor() {
    super("The walkthrough generation changed.");
    this.name = this._tag;
  }
}
