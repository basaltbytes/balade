/** Terminal rendering policy for owned generation progress. */

import type { AuthorOutput } from "../../pi/author.js";
import { formatElapsed, sanitizeTerminalText, warningText, type Theme } from "../../terminal.js";
import type { GenerationProgress, GenerationStatus, GenerationTiming } from "./progress.js";

/** Presentation detail belongs to this renderer, never the Pi adapter. */
export type GenerationProgressMode = "compact" | "verbose";

/** A TTY can redraw current state; a pipe can only append lifecycle events. */
export type GenerationProgressPresentation = "tty" | "pipe";

export interface GenerationProgressRendererOptions {
  readonly write: (value: string) => void;
  readonly mode: GenerationProgressMode;
  readonly presentation: GenerationProgressPresentation;
  readonly theme: Theme;
  readonly onStatus: (status: GenerationStatus) => void;
}

export function generationStatusText(status: GenerationStatus): string {
  switch (status._tag) {
    case "PreparingGeneration":
      return "Preparing the authoring session…";
    case "AuthoringGeneration":
      return `Authoring the walkthrough (turn ${status.turn})…`;
    case "RunningAuthorTool":
      return authorToolCopy(status.name).active;
    case "CheckingGeneration":
      return `Checking the draft against the pinned source (pass ${status.pass})…`;
    case "RepairingGeneration":
      return `Repairing the draft (attempt ${status.attempt} of ${status.maximumAttempts})…`;
  }
}

function generationStatusStartedText(status: GenerationStatus, theme: Theme): string {
  const mark = theme.muted("→");
  switch (status._tag) {
    case "PreparingGeneration":
      return `${mark} Started preparing the authoring session.`;
    case "AuthoringGeneration":
      return `${mark} Started authoring the walkthrough (turn ${status.turn}).`;
    case "RunningAuthorTool":
      return `${mark} ${authorToolCopy(status.name).started}`;
    case "CheckingGeneration":
      return `${mark} Started checking the draft against the pinned source (pass ${status.pass}).`;
    case "RepairingGeneration":
      return `${mark} Started repairing the draft (attempt ${status.attempt} of ${status.maximumAttempts}).`;
  }
}

export function generationTimingText(timing: GenerationTiming): string {
  const details = timing.segments.map((segment) => {
    switch (segment._tag) {
      case "PreparationTiming":
        return `preparation ${formatElapsed(segment.milliseconds)}`;
      case "AuthorTurnTiming":
        return `turn ${segment.turn} ${formatElapsed(segment.milliseconds)}`;
      case "CheckTiming":
        return `check ${segment.pass} ${formatElapsed(segment.milliseconds)}`;
    }
  });
  const suffix = details.length === 0 ? "" : ` (${details.join(", ")})`;
  return `Elapsed ${formatElapsed(timing.totalMilliseconds)} total${suffix}.`;
}

export function makeGenerationProgress({
  write,
  mode,
  presentation,
  theme,
  onStatus,
}: GenerationProgressRendererOptions): (event: GenerationProgress) => void {
  let turn = 0;
  const announcedAuthorTurns = new Set<number>();
  return (event) => {
    switch (event._tag) {
      case "GenerationStatusChanged":
        onStatus(event.status);
        if (presentation === "pipe" && shouldAnnounceStatus(event.status, announcedAuthorTurns)) {
          write(`${generationStatusStartedText(event.status, theme)}\n`);
        }
        break;
      case "AuthorNotice":
        write(warningText(event, theme));
        break;
      case "AuthorUsageUpdated":
        turn++;
        write(usageText(turn, event, theme));
        break;
      case "AuthorAssistantText":
        if (mode === "verbose") {
          write(`[assistant]\n${withTrailingNewline(sanitizeTerminalText(event.text))}`);
        }
        break;
      case "AuthorToolStarted":
        if (mode === "verbose") {
          const input = sanitizeTerminalText(event.input);
          write(`[${sanitizeTerminalText(event.name)}]${input === "" ? "" : ` ${input}`}\n`);
        }
        break;
      case "AuthorToolFinished":
        if (mode === "verbose") {
          if (event.output !== "") write(withTrailingNewline(sanitizeTerminalText(event.output)));
          write(`[/${sanitizeTerminalText(event.name)}${event.failed ? " error" : ""}]\n`);
        }
        write(authorToolCompletionText(event.name, event.failed, theme));
        break;
    }
  };
}

function usageText(
  turn: number,
  event: Extract<AuthorOutput, { _tag: "AuthorUsageUpdated" }>,
  theme: Theme,
): string {
  const usage = event.usage;
  return (
    theme.muted(
      `Turn ${turn}: ${usage.total.toLocaleString("en-US")} cumulative tokens ` +
        `(in ${usage.input.toLocaleString("en-US")}, out ${usage.output.toLocaleString("en-US")}, ` +
        `cache ${usage.cacheRead.toLocaleString("en-US")}/${usage.cacheWrite.toLocaleString("en-US")}); ` +
        `cumulative cost $${usage.cost.toFixed(4)}`,
    ) + "\n"
  );
}

function withTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

interface AuthorToolCopy {
  readonly active: string;
  readonly started: string;
  readonly completed: string;
  readonly failed: string;
}

function authorToolCopy(tool: string): AuthorToolCopy {
  switch (tool) {
    case "list_pr_changes":
    case "list_source_files":
      return {
        active: "Inspecting pull-request changes…",
        started: "Started inspecting pull-request changes.",
        completed: "Inspected pull-request changes.",
        failed: "Could not inspect pull-request changes.",
      };
    case "read_pr_diff":
      return {
        active: "Reading relevant diffs…",
        started: "Started reading relevant diffs.",
        completed: "Read relevant diffs.",
        failed: "Could not read relevant diffs.",
      };
    case "search_source":
      return {
        active: "Searching pinned source…",
        started: "Started searching pinned source.",
        completed: "Searched pinned source.",
        failed: "Could not search pinned source.",
      };
    case "read_source":
    case "read_base_source":
      return {
        active: "Confirming pinned source ranges…",
        started: "Started confirming pinned source ranges.",
        completed: "Confirmed pinned source ranges.",
        failed: "Could not confirm pinned source ranges.",
      };
    case "submit_walkthrough":
      return {
        active: "Submitting the walkthrough draft…",
        started: "Started submitting the walkthrough draft.",
        completed: "Submitted the walkthrough draft.",
        failed: "Could not submit the walkthrough draft.",
      };
    default:
      return {
        active: "Using an authoring tool…",
        started: "Started an authoring tool.",
        completed: "Completed an authoring tool.",
        failed: "An authoring tool failed.",
      };
  }
}

function authorToolCompletionText(tool: string, failed: boolean, theme: Theme): string {
  const copy = authorToolCopy(tool);
  return failed ? `${theme.error("✗")} ${copy.failed}\n` : `${theme.ok("✓")} ${copy.completed}\n`;
}

function shouldAnnounceStatus(
  status: GenerationStatus,
  announcedAuthorTurns: Set<number>,
): boolean {
  switch (status._tag) {
    case "AuthoringGeneration":
      if (announcedAuthorTurns.has(status.turn)) return false;
      announcedAuthorTurns.add(status.turn);
      return true;
    case "RepairingGeneration":
      announcedAuthorTurns.add(status.attempt + 1);
      return true;
    case "PreparingGeneration":
    case "RunningAuthorTool":
    case "CheckingGeneration":
      return true;
  }
}
