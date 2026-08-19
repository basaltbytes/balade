import type { AuthorChangedFile, AuthorDraft } from "../../src/pi/author.js";

export type AuthoringTranscriptStep =
  | {
      readonly _tag: "Tool";
      readonly name: "list_pr_changes" | "search_source" | "read_pr_diff" | "read_source";
      readonly input: Readonly<Record<string, string | number>>;
    }
  | { readonly _tag: "Submit"; readonly draft: AuthorDraft };

export interface AuthoringDecisionExpectation {
  readonly groups: readonly string[];
  readonly omittedGroups: readonly string[];
  readonly sections: { readonly minimum: number; readonly maximum: number };
  readonly codeRanges: { readonly minimum: number; readonly maximum: number };
  readonly referencedFiles: readonly string[];
  readonly unreferencedFiles: readonly string[];
  readonly phrases: readonly string[];
  readonly decision: string;
}

export interface AuthoringEvalCase {
  readonly id: "feature" | "refactor" | "bugfix" | "mechanical-rename" | "docs-only";
  readonly title: string;
  readonly baseFiles: Readonly<Record<string, string>>;
  readonly headFiles: Readonly<Record<string, string>>;
  readonly changedFiles: readonly AuthorChangedFile[];
  readonly transcript: readonly AuthoringTranscriptStep[];
  readonly expected: AuthoringDecisionExpectation;
}

const CLOSING_FULL_PR_DIFF = `{% group label="Full PR diff" %}

{% section id="files" title="Full PR diff" icon="file-diff" %}

{% files /%}

{% /section %}

{% /group %}`;

export const AUTHORING_EVAL_CASES = [
  {
    id: "feature",
    title: "Add status-aware retry policy",
    baseFiles: {
      "src/retries.ts": `export interface RetryPolicy {
  readonly attempts: number;
}

export function shouldRetry(policy: RetryPolicy, attempt: number): boolean {
  return attempt < policy.attempts;
}
`,
    },
    headFiles: {
      "src/retries.ts": `export interface RetryPolicy {
  readonly attempts: number;
  readonly retryableStatuses: readonly number[];
}

export function shouldRetry(
  policy: RetryPolicy,
  status: number,
  attempt: number,
): boolean {
  return attempt < policy.attempts && policy.retryableStatuses.includes(status);
}
`,
      "test/retries.test.ts": `import { shouldRetry } from "../src/retries.js";

it("stops on a non-retryable status", () => {
  const policy = { attempts: 3, retryableStatuses: [429, 503] };

  expect(shouldRetry(policy, 400, 0)).toBe(false);
  expect(shouldRetry(policy, 503, 2)).toBe(true);
  expect(shouldRetry(policy, 503, 3)).toBe(false);
});
`,
    },
    changedFiles: [
      { path: "src/retries.ts", status: "M", additions: 8, deletions: 2 },
      { path: "test/retries.test.ts", status: "A", additions: 9, deletions: 0 },
    ],
    transcript: [
      { _tag: "Tool", name: "read_pr_diff", input: { path: "src/retries.ts" } },
      {
        _tag: "Tool",
        name: "search_source",
        input: { query: "shouldRetry", mode: "fixed" },
      },
      { _tag: "Tool", name: "read_source", input: { path: "src/retries.ts", from: 1, to: 12 } },
      {
        _tag: "Tool",
        name: "read_source",
        input: { path: "test/retries.test.ts", from: 1, to: 9 },
      },
      {
        _tag: "Submit",
        draft: {
          title: "Status-aware retries",
          meta: { lang: "en", area: "runtime" },
          body: `{% group label="Orientation" %}

{% section id="overview" title="Retry decision" %}

The retry policy now checks the response status as well as the attempt count. A caller can stop on permanent failures without changing the shared retry loop.

{% /section %}

{% /group %}

{% group label="Models" %}

{% section id="policy" title="Policy inputs" %}

The policy names the retryable statuses. The function returns true only while both limits allow another request.

{% code file="src/retries.ts" from=1 to=12 expect="export interface RetryPolicy {" /%}

{% /section %}

{% /group %}

{% group label="Quality" %}

{% section id="tests" title="Boundary tests" %}

{% tests %}
{% test name="stops on a non-retryable status" kind="unit" ref="test/retries.test.ts" asserts=["HTTP 400 does not retry.", "HTTP 503 retries before the attempt limit.", "HTTP 503 stops at the attempt limit."] %}
The scenario separates a permanent status, the last permitted retry, and an exhausted policy.
{% /test %}
{% /tests %}

{% /section %}

{% /group %}

${CLOSING_FULL_PR_DIFF}`,
        },
      },
    ],
    expected: {
      groups: ["Orientation", "Models", "Quality", "Full PR diff"],
      omittedGroups: ["Surface", "Mechanism"],
      sections: { minimum: 4, maximum: 4 },
      codeRanges: { minimum: 1, maximum: 1 },
      referencedFiles: ["src/retries.ts"],
      unreferencedFiles: ["test/retries.test.ts"],
      phrases: ["response status", "attempt count", "permanent failures"],
      decision: "The new policy shape and its boundary proof each deserve a section.",
    },
  },
  {
    id: "refactor",
    title: "Separate invoice totals from formatting",
    baseFiles: {
      "src/format.ts": `export function formatInvoice(lines: readonly number[]): string {
  const total = lines.reduce((sum, amount) => sum + amount, 0);
  return \`Total: $\${total.toFixed(2)}\`;
}
`,
    },
    headFiles: {
      "src/invoice-total.ts": `export function invoiceTotal(lines: readonly number[]): number {
  return lines.reduce((sum, amount) => sum + amount, 0);
}
`,
      "src/format-invoice.ts": `import { invoiceTotal } from "./invoice-total.js";

export function formatInvoice(lines: readonly number[]): string {
  return \`Total: $\${invoiceTotal(lines).toFixed(2)}\`;
}
`,
    },
    changedFiles: [
      { path: "src/format.ts", status: "D", additions: 0, deletions: 4 },
      { path: "src/invoice-total.ts", status: "A", additions: 3, deletions: 0 },
      { path: "src/format-invoice.ts", status: "A", additions: 5, deletions: 0 },
    ],
    transcript: [
      { _tag: "Tool", name: "list_pr_changes", input: {} },
      {
        _tag: "Tool",
        name: "read_source",
        input: { path: "src/invoice-total.ts", from: 1, to: 3 },
      },
      {
        _tag: "Tool",
        name: "read_source",
        input: { path: "src/format-invoice.ts", from: 1, to: 5 },
      },
      {
        _tag: "Submit",
        draft: {
          title: "Invoice formatting split",
          meta: { lang: "en", area: "billing" },
          body: `{% group label="Orientation" %}

{% section id="overview" title="One calculation boundary" %}

Invoice totals no longer live inside string formatting. Callers can reuse the numeric total without parsing display text.

{% files why={"src/format.ts": "replaced by the calculation and formatting modules"} /%}

{% /section %}

{% /group %}

{% group label="Mechanism" %}

{% section id="split" title="Calculation before presentation" %}

The old function accepted the line amounts and returned one display string, so the sum and the currency text were computed in the same pass. The change gives each job its own function and fixes their order. invoiceTotal accepts the line amounts and returns the numeric total; it applies no rounding, no symbol, and no locale. formatInvoice calls invoiceTotal first, rounds the returned number to two decimals, and only then builds the currency text. A caller that needs the amount stops after the first function and never parses display text. No path produces the text without the number, so the two results cannot disagree.

\`\`\`mermaid
flowchart TD
  lines[Line amounts] --> total[invoiceTotal]
  total --> number[Numeric total]
  number --> format[formatInvoice]
  format --> text[Currency text]
\`\`\`

The first function returns a number. It sums the line amounts with one reduce and stops there, so no display rule can reach the arithmetic.

{% code file="src/invoice-total.ts" from=1 to=3 expect="export function invoiceTotal(lines: readonly number[]): number {" collapsed=true /%}

The formatter consumes that result and owns the currency text. It imports the calculation instead of repeating it, so the rounding and the symbol have exactly one home.

{% code file="src/format-invoice.ts" from=1 to=5 expect="import { invoiceTotal } from \\"./invoice-total.js\\";" collapsed=true /%}

{% /section %}

{% /group %}

${CLOSING_FULL_PR_DIFF}`,
        },
      },
    ],
    expected: {
      groups: ["Orientation", "Mechanism", "Full PR diff"],
      omittedGroups: ["Models", "Surface", "Quality"],
      sections: { minimum: 3, maximum: 3 },
      codeRanges: { minimum: 2, maximum: 2 },
      referencedFiles: ["src/invoice-total.ts", "src/format-invoice.ts"],
      unreferencedFiles: ["src/format.ts"],
      phrases: ["numeric total", "string formatting", "currency text", "flowchart TD"],
      decision:
        "One mechanism section explains the split; the deleted file needs only a files entry.",
    },
  },
  {
    id: "bugfix",
    title: "Include the final batch item",
    baseFiles: {
      "src/batches.ts": `export function batchEnd(start: number, size: number, count: number): number {
  return Math.min(start + size - 1, count - 1);
}
`,
      "test/batches.test.ts": `import { batchEnd } from "../src/batches.js";

it("caps a batch at the final index", () => {
  expect(batchEnd(8, 3, 10)).toBe(9);
});
`,
    },
    headFiles: {
      "src/batches.ts": `export function batchEnd(start: number, size: number, count: number): number {
  return Math.min(start + size, count) - 1;
}
`,
      "test/batches.test.ts": `import { batchEnd } from "../src/batches.js";

it("includes the final item of a full batch", () => {
  expect(batchEnd(0, 3, 10)).toBe(2);
});

it("caps a short final batch at the last index", () => {
  expect(batchEnd(8, 3, 10)).toBe(9);
});
`,
    },
    changedFiles: [
      { path: "src/batches.ts", status: "M", additions: 1, deletions: 1 },
      { path: "test/batches.test.ts", status: "M", additions: 6, deletions: 1 },
    ],
    transcript: [
      { _tag: "Tool", name: "read_pr_diff", input: { path: "src/batches.ts" } },
      {
        _tag: "Tool",
        name: "read_source",
        input: { path: "src/batches.ts", from: 1, to: 3 },
      },
      {
        _tag: "Tool",
        name: "read_source",
        input: { path: "test/batches.test.ts", from: 1, to: 9 },
      },
      {
        _tag: "Submit",
        draft: {
          title: "Batch end boundary",
          meta: { lang: "en", area: "pagination" },
          body: `{% group label="Orientation" %}

{% section id="overview" title="Inclusive batch end" %}

The old expression could describe the boundary in two coordinate systems. The new expression computes an exclusive end first, then converts it to the final included index.

{% code file="src/batches.ts" from=1 to=3 expect="export function batchEnd(start: number, size: number, count: number): number {" /%}

{% /section %}

{% /group %}

{% group label="Quality" %}

{% section id="regression" title="Regression cases" %}

{% tests %}
{% test name="batch end boundaries" kind="unit" ref="test/batches.test.ts" asserts=["A complete batch includes its last item.", "A short final batch stops at the last available index."] %}
The scenarios cover a complete batch and a short final batch.
{% /test %}
{% /tests %}

{% /section %}

{% /group %}

${CLOSING_FULL_PR_DIFF}`,
        },
      },
    ],
    expected: {
      groups: ["Orientation", "Quality", "Full PR diff"],
      omittedGroups: ["Models", "Surface", "Mechanism"],
      sections: { minimum: 3, maximum: 3 },
      codeRanges: { minimum: 1, maximum: 1 },
      referencedFiles: ["src/batches.ts"],
      unreferencedFiles: ["test/batches.test.ts"],
      phrases: ["exclusive end", "final included index", "short final batch"],
      decision: "The fix and its regression proof are the whole review story.",
    },
  },
  {
    id: "mechanical-rename",
    title: "Rename customer label to client label",
    baseFiles: {
      "src/customer-label.ts": `export function customerLabel(name: string): string {
  return name.trim();
}
`,
      "src/header.ts": `import { customerLabel } from "./customer-label.js";

export const header = (name: string): string => customerLabel(name);
`,
    },
    headFiles: {
      "src/client-label.ts": `export function clientLabel(name: string): string {
  return name.trim();
}
`,
      "src/header.ts": `import { clientLabel } from "./client-label.js";

export const header = (name: string): string => clientLabel(name);
`,
    },
    changedFiles: [
      {
        path: "src/client-label.ts",
        oldPath: "src/customer-label.ts",
        status: "R",
        additions: 1,
        deletions: 1,
      },
      { path: "src/header.ts", status: "M", additions: 2, deletions: 2 },
    ],
    transcript: [
      { _tag: "Tool", name: "list_pr_changes", input: {} },
      {
        _tag: "Submit",
        draft: {
          title: "Client label rename",
          meta: { lang: "en", area: "naming" },
          body: `{% group label="Orientation" %}

{% section id="overview" title="Terminology rename" %}

The public helper and its caller now use client instead of customer. Behavior and arguments do not change.

{% /section %}

{% /group %}

${CLOSING_FULL_PR_DIFF}`,
        },
      },
    ],
    expected: {
      groups: ["Orientation", "Full PR diff"],
      omittedGroups: ["Models", "Surface", "Quality", "Mechanism"],
      sections: { minimum: 2, maximum: 2 },
      codeRanges: { minimum: 0, maximum: 0 },
      referencedFiles: [],
      unreferencedFiles: ["src/client-label.ts", "src/header.ts"],
      phrases: ["client instead of customer", "Behavior and arguments do not change"],
      decision: "A mechanical rename gets one orientation section and no file-by-file narration.",
    },
  },
  {
    id: "docs-only",
    title: "Document retry limits",
    baseFiles: {
      "docs/retries.md": `# Retry policy

Requests can retry after a temporary failure.
`,
    },
    headFiles: {
      "docs/retries.md": `# Retry policy

Requests retry at most three times after HTTP 429 or 503.
The delay starts at 200 ms and doubles after each failed attempt.

HTTP 400 and authentication failures return immediately.
Set \`retries: 0\` to disable retries.
`,
    },
    changedFiles: [{ path: "docs/retries.md", status: "M", additions: 5, deletions: 1 }],
    transcript: [
      { _tag: "Tool", name: "read_pr_diff", input: { path: "docs/retries.md" } },
      {
        _tag: "Tool",
        name: "read_source",
        input: { path: "docs/retries.md", from: 1, to: 7 },
      },
      {
        _tag: "Submit",
        draft: {
          title: "Retry policy documentation",
          meta: { lang: "en", area: "docs" },
          body: `{% group label="Orientation" %}

{% section id="overview" title="Documented operating limits" %}

The guide now names the retry count, status codes, delay, and opt-out setting. It gives operators one complete policy instead of an open-ended promise to retry.

{% /section %}

{% /group %}

{% group label="Surface" %}

{% section id="policy" title="Published retry contract" %}

{% code file="docs/retries.md" from=1 to=7 expect="# Retry policy" /%}

Permanent client and authentication failures return without delay.

{% /section %}

{% /group %}

${CLOSING_FULL_PR_DIFF}`,
        },
      },
    ],
    expected: {
      groups: ["Orientation", "Surface", "Full PR diff"],
      omittedGroups: ["Models", "Quality", "Mechanism"],
      sections: { minimum: 3, maximum: 3 },
      codeRanges: { minimum: 1, maximum: 1 },
      referencedFiles: ["docs/retries.md"],
      unreferencedFiles: [],
      phrases: ["retry count", "status codes", "opt-out setting"],
      decision:
        "Documentation is the changed surface, so it gets one evidence section and no code-anatomy groups.",
    },
  },
] satisfies readonly AuthoringEvalCase[];
