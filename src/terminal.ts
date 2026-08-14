/**
 * Reports become terminal output here, and only here. The text form and
 * `check --json` carry the same facts: every diagnostic with its code and fix
 * hint, and the first and last resolved line of every code range, so an
 * authoring agent self-verifies in one pass.
 *
 * Terminal text is untrusted at the process edge: PR-derived values are
 * stripped of controls where they are interpolated, and the writers admit only
 * the theme's own color sequences, so no untrusted escape reaches the terminal.
 */

import { stripVTControlCharacters, styleText } from "node:util";
import type { CheckDiagnostic, CheckReport, RangeEcho } from "./contract/types.js";

export function sanitizeTerminalText(value: string): string {
  let safe = "";
  for (const character of stripVTControlCharacters(value)) {
    const point = character.codePointAt(0);
    if (
      point === undefined ||
      point === 9 ||
      point === 10 ||
      point === 13 ||
      (point >= 32 && (point < 127 || point > 159))
    ) {
      safe += character;
    }
  }
  return safe;
}

/**
 * The single-parameter SGR sequences the themes below emit, and nothing more.
 * Conceal (8), cursor movement, OSC hyperlinks and every other control stay
 * stripped, so a value that skipped `sanitizeTerminalText` can at worst borrow
 * a palette color — it cannot hide text or move the cursor.
 */
const THEME_SGR_PARAMS = new Set(["1", "2", "4", "22", "24", "31", "32", "33", "36", "39"]);

const SGR_OPEN = "\u001b[";

export function sanitizeStyledTerminalText(value: string): string {
  let safe = "";
  let start = 0;
  let index = value.indexOf(SGR_OPEN);
  while (index !== -1) {
    /* Palette parameters are one or two digits, so the closing `m` is looked
       for in a three-character window: a hostile stream of bare openers
       cannot turn this scan quadratic. */
    const paramsStart = index + SGR_OPEN.length;
    const window = value.slice(paramsStart, paramsStart + 3);
    const close = window.indexOf("m");
    if (close !== -1 && THEME_SGR_PARAMS.has(window.slice(0, close))) {
      const end = paramsStart + close + 1;
      safe += sanitizeTerminalText(value.slice(start, index));
      safe += value.slice(index, end);
      start = end;
      index = value.indexOf(SGR_OPEN, end);
    } else {
      index = value.indexOf(SGR_OPEN, paramsStart);
    }
  }
  return safe + sanitizeTerminalText(value.slice(start));
}

export function writeStdout(value: string): void {
  process.stdout.write(sanitizeStyledTerminalText(value));
}

export function writeStderr(value: string): void {
  process.stderr.write(sanitizeStyledTerminalText(value));
}

/** Semantic color slots; formatters never name raw colors. */
export interface Theme {
  readonly error: (text: string) => string;
  readonly warning: (text: string) => string;
  readonly ok: (text: string) => string;
  readonly emphasis: (text: string) => string;
  readonly muted: (text: string) => string;
  readonly url: (text: string) => string;
}

/**
 * The default everywhere a formatted string can leave the terminal: tests,
 * `check --json` siblings, and the repair prompt sent back to the model.
 */
export const plainTheme: Theme = {
  error: (text) => text,
  warning: (text) => text,
  ok: (text) => text,
  emphasis: (text) => text,
  muted: (text) => text,
  url: (text) => text,
};

/* `styleText` validates the stream per call: piped output, NO_COLOR and
   FORCE_COLOR all resolve to the right answer without a flag of our own. */
const styledTheme = (stream: NodeJS.WriteStream): Theme => ({
  error: (text) => styleText(["bold", "red"], text, { stream }),
  warning: (text) => styleText(["bold", "yellow"], text, { stream }),
  ok: (text) => styleText(["bold", "green"], text, { stream }),
  emphasis: (text) => styleText("bold", text, { stream }),
  muted: (text) => styleText("dim", text, { stream }),
  url: (text) => styleText(["cyan", "underline"], text, { stream }),
});

export const stdoutTheme: Theme = styledTheme(process.stdout);
export const stderrTheme: Theme = styledTheme(process.stderr);

export function formatJson(outcome: {
  readonly _tag: "CheckPassed" | "CheckFailed";
  readonly reports: readonly CheckReport[];
}): string {
  return JSON.stringify({ ok: outcome._tag === "CheckPassed", reports: outcome.reports }, null, 2);
}

export function formatText(
  outcome: {
    readonly reports: readonly CheckReport[];
    readonly note?: string;
  },
  theme: Theme = plainTheme,
): string {
  const lines: string[] = [];
  if (outcome.note !== undefined) lines.push(sanitizeTerminalText(outcome.note));

  for (const report of outcome.reports) {
    lines.push("");
    lines.push(theme.emphasis(sanitizeTerminalText(report.file)));
    for (const diagnostic of report.diagnostics) lines.push(...formatDiagnostic(diagnostic, theme));
    if (report.ranges.length > 0) {
      lines.push("");
      lines.push(
        theme.muted(
          `  code ranges (${report.ranges.length}) — check that each pair frames what you describe`,
        ),
      );
      for (const range of report.ranges) lines.push(...formatRange(range, theme));
    }
    lines.push("");
    lines.push(`  ${summary(report, theme)}`);
  }

  if (outcome.reports.length > 1) {
    const failed = outcome.reports.filter((report) => !report.ok).length;
    lines.push("");
    lines.push(
      failed === 0
        ? theme.ok(`${outcome.reports.length} walkthroughs pass.`)
        : theme.error(`${failed} of ${outcome.reports.length} walkthroughs fail.`),
    );
  }
  return `${lines.join("\n").trimStart()}\n`;
}

function formatDiagnostic(diagnostic: CheckDiagnostic, theme: Theme): string[] {
  const mark = diagnostic.level === "error" ? theme.error("error  ") : theme.warning("warning");
  const file = sanitizeTerminalText(diagnostic.file);
  const where = diagnostic.line === undefined ? file : `${file}:${diagnostic.line}`;
  const lines = [
    `  ${mark} ${sanitizeTerminalText(diagnostic.code)}  ${where}`,
    `      ${sanitizeTerminalText(diagnostic.message)}`,
  ];
  if (diagnostic.expected !== undefined) {
    lines.push(`      ${theme.muted("expected")}  ${sanitizeTerminalText(diagnostic.expected)}`);
  }
  if (diagnostic.actual !== undefined) {
    lines.push(`      ${theme.muted("actual")}    ${sanitizeTerminalText(diagnostic.actual)}`);
  }
  if (diagnostic.hint !== undefined) {
    lines.push(`      ${theme.muted("fix")}       ${sanitizeTerminalText(diagnostic.hint)}`);
  }
  return lines;
}

function formatRange(range: RangeEcho, theme: Theme): string[] {
  return [
    `    ${sanitizeTerminalText(range.file)}:${range.from}-${range.to}`,
    `      ${theme.muted("first")}  ${sanitizeTerminalText(range.firstLine.trim())}`,
    `      ${theme.muted("last")}   ${sanitizeTerminalText(range.lastLine.trim())}`,
  ];
}

function summary(report: CheckReport, theme: Theme): string {
  const errors = report.diagnostics.filter((diagnostic) => diagnostic.level === "error").length;
  const warnings = report.diagnostics.length - errors;
  if (errors === 0 && warnings === 0) return theme.ok("ok");
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
  return report.ok
    ? `${theme.warning("ok with")} ${parts.join(", ")}`
    : `${theme.error("failed —")} ${parts.join(", ")}`;
}

/** The three-line warning shape every command speaks: mark, message, fix. */
export function warningText(
  warning: { readonly code: string; readonly message: string; readonly hint: string },
  theme: Theme = plainTheme,
): string {
  return (
    `${theme.warning("warning")} ${sanitizeTerminalText(warning.code)}\n` +
    `  ${sanitizeTerminalText(warning.message)}\n` +
    `  ${theme.muted("fix")} ${sanitizeTerminalText(warning.hint)}\n`
  );
}

/** The boundary echo is a `check` affordance for the author; soft commands show diagnostics only. */
const diagnosticsOnly = (reports: readonly CheckReport[]): readonly CheckReport[] =>
  reports.map((report) => ({ ...report, ranges: [] }));

export const stopReports = (reports: readonly CheckReport[]): void => {
  writeStdout(formatText({ reports: diagnosticsOnly(reports) }, stdoutTheme));
  process.exitCode = 1;
};

export const stopMessage = (message: string): void => {
  writeStderr(`${stderrTheme.error(sanitizeTerminalText(message))}\n`);
  process.exitCode = 1;
};

/** Soft commands: what did not resolve is printed here and rides on as error cards. */
export const printSoft = (reports: readonly CheckReport[]): void => {
  const diagnostics = diagnosticsOnly(reports);
  if (diagnostics.some((report) => report.diagnostics.length > 0)) {
    writeStdout(formatText({ reports: diagnostics }, stdoutTheme));
  }
};

export const served = (paths: readonly string[]): string =>
  paths.length === 1 ? (paths[0] ?? "") : `${paths.length} walkthroughs`;

export const size = (bytes: number): string =>
  bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1000)} kB`;
