/** Terminal rendering policy for owned generation progress. */

import type { AuthorOutput } from "../../pi/author.js";
import {
  formatElapsed,
  plainTheme,
  sanitizeTerminalText,
  warningText,
  type Theme,
} from "../../terminal.js";
import type { GenerationProgress, GenerationStatus, GenerationTiming } from "./progress.js";

/** Presentation detail belongs to this renderer, never the Pi adapter. */
export type GenerationProgressMode = "compact" | "verbose";

export function generationStatusText(status: GenerationStatus): string {
  switch (status._tag) {
    case "PreparingGeneration":
      return "Preparing the authoring session…";
    case "AuthoringGeneration":
      return `Authoring the walkthrough (turn ${status.turn})…`;
    case "RunningAuthorTool":
      return authorToolText(status.name);
    case "CheckingGeneration":
      return `Checking the draft against the pinned source (pass ${status.pass})…`;
    case "RepairingGeneration":
      return `Repairing the draft (attempt ${status.attempt} of ${status.maximumAttempts})…`;
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

export function makeGenerationProgress(
  write: (value: string) => void,
  mode: GenerationProgressMode = "compact",
  theme: Theme = plainTheme,
  onStatus: (status: GenerationStatus) => void = () => {},
): (event: GenerationProgress) => void {
  let turn = 0;
  return (event) => {
    switch (event._tag) {
      case "GenerationStatusChanged":
        onStatus(event.status);
        if (mode === "compact" || event.status._tag !== "RunningAuthorTool") {
          write(`${generationStatusText(event.status)}\n`);
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

function authorToolText(tool: string): string {
  switch (tool) {
    case "list_pr_changes":
    case "list_source_files":
      return "Inspecting pull-request changes…";
    case "read_pr_diff":
      return "Reading relevant diffs…";
    case "search_source":
      return "Searching pinned source…";
    case "read_source":
    case "read_base_source":
      return "Confirming pinned source ranges…";
    case "submit_walkthrough":
      return "Submitting the walkthrough draft…";
    default:
      return "Using an authoring tool…";
  }
}
