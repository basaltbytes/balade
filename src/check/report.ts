/**
 * Diagnostic output shared by `check`, `build` and `open`. The text form and
 * `check --json` carry the same facts: every
 * diagnostic with its code and fix hint, and the first and last resolved line
 * of every code range, so an authoring agent self-verifies in one pass.
 */

import type { CheckDiagnostic, CheckReport, RangeEcho } from "../contract/types.js";
import type { CheckOutcome } from "../walkthrough/validate.js";

export function formatJson(outcome: CheckOutcome): string {
  return JSON.stringify({ ok: outcome._tag === "CheckPassed", reports: outcome.reports }, null, 2);
}

export function formatText(outcome: {
  readonly reports: readonly CheckReport[];
  readonly note?: string;
}): string {
  const lines: string[] = [];
  if (outcome.note !== undefined) lines.push(outcome.note);

  for (const report of outcome.reports) {
    lines.push("");
    lines.push(report.file);
    for (const diagnostic of report.diagnostics) lines.push(...formatDiagnostic(diagnostic));
    if (report.ranges.length > 0) {
      lines.push("");
      lines.push(
        `  code ranges (${report.ranges.length}) — check that each pair frames what you describe`,
      );
      for (const range of report.ranges) lines.push(...formatRange(range));
    }
    lines.push("");
    lines.push(`  ${summary(report)}`);
  }

  if (outcome.reports.length > 1) {
    const failed = outcome.reports.filter((report) => !report.ok).length;
    lines.push("");
    lines.push(
      failed === 0
        ? `${outcome.reports.length} walkthroughs pass.`
        : `${failed} of ${outcome.reports.length} walkthroughs fail.`,
    );
  }
  return `${lines.join("\n").trimStart()}\n`;
}

function formatDiagnostic(diagnostic: CheckDiagnostic): string[] {
  const mark = diagnostic.level === "error" ? "error  " : "warning";
  const where =
    diagnostic.line === undefined ? diagnostic.file : `${diagnostic.file}:${diagnostic.line}`;
  const lines = [`  ${mark} ${diagnostic.code}  ${where}`, `      ${diagnostic.message}`];
  if (diagnostic.expected !== undefined) lines.push(`      expected  ${diagnostic.expected}`);
  if (diagnostic.actual !== undefined) lines.push(`      actual    ${diagnostic.actual}`);
  if (diagnostic.hint !== undefined) lines.push(`      fix       ${diagnostic.hint}`);
  return lines;
}

function formatRange(range: RangeEcho): string[] {
  return [
    `    ${range.file}:${range.from}-${range.to}`,
    `      first  ${range.firstLine.trim()}`,
    `      last   ${range.lastLine.trim()}`,
  ];
}

function summary(report: CheckReport): string {
  const errors = report.diagnostics.filter((diagnostic) => diagnostic.level === "error").length;
  const warnings = report.diagnostics.length - errors;
  if (errors === 0 && warnings === 0) return "ok";
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
  return `${report.ok ? "ok with" : "failed —"} ${parts.join(", ")}`;
}
