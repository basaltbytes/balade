/**
 * Two complete exemplar walkthroughs, taught before any rule. The model
 * imitates the artifact it is shown, so every structural convention appears
 * here correct instead of being legislated in prose: the overview opens,
 * every section sits in a labelled group and carries an icon, evidence sits
 * under its claim, the bare full-PR diff closes. Tests parse both documents
 * against the real Markdoc config and pin that structure.
 */

export interface AuthoringExemplar {
  /** Which pull-request shape the exemplar answers. */
  readonly name: "feature" | "documentation";
  /** One-line description of the fictional pull request, shown above the document. */
  readonly context: string;
  /** The complete walkthrough body, valid against the real Markdoc config. */
  readonly document: string;
}

export const AUTHORING_EXEMPLARS: readonly AuthoringExemplar[] = [
  {
    name: "feature",
    context:
      "The pull request adds retry with exponential backoff to an upload queue: one new module, one changed caller, one test file.",
    document: `{% group label="Overview" %}
{% section id="overview" title="Retry for failed uploads" icon="sync" %}
A failed chunk upload now retries up to three times with exponential backoff instead of failing the whole batch. The constraint that shapes the change: a retry must never reorder chunks within one file.

{% callout tone="key" %}
The retry counter lives on the queue entry, not on the connection, so a reconnect does not reset it.
{% /callout %}
{% /section %}
{% /group %}

{% group label="Retry mechanism" %}
{% section id="backoff" title="Backoff and give-up decisions" icon="iterations" related=["proof"] %}
\`enqueue\` tags every chunk with attempt 0. On failure, the delay doubles from a 500 ms base, and the fourth failure moves the chunk to the dead-letter list instead of the queue.

\`\`\`pseudo
on chunk failure
  if attempts is 3
    move chunk to dead-letter
  else
    wait 500ms * 2^attempts
    requeue chunk, attempts + 1
\`\`\`

The give-up branch is the critical decision:

{% code file="src/upload/queue.ts" from=41 to=58 expect="function retryDelay" collapsed=true /%}
{% /section %}
{% section id="ordering" title="Order kept within one file" icon="workflow" %}
A requeued chunk re-enters at the head of its file's lane, not at the global queue tail, so chunk order within one file survives a retry.

{% code file="src/upload/lanes.ts" from=12 to=24 expect="export function requeue" /%}
{% /section %}
{% /group %}

{% group label="Proof" %}
{% section id="proof" title="Retry regression tests" icon="beaker" %}
{% tests %}
{% test name="gives up after three attempts" kind="unit" ref="test/queue.test.ts" asserts=["moves the chunk to dead-letter", "doubles the delay each retry"] %}A chunk that always fails lands in the dead-letter list after the third attempt.{% /test %}
{% /tests %}
{% /section %}
{% /group %}

{% group label="Full PR diff" %}
{% section id="files" title="Full PR diff" icon="file-diff" %}
{% files /%}
{% /section %}
{% /group %}`,
  },
  {
    name: "documentation",
    context:
      "The pull request fixes six typos in an install guide and renames one anchor. The whole walkthrough:",
    document: `{% group label="Overview" %}
{% section id="overview" title="Install guide typo fixes" icon="book" %}
Six typos fixed in the install guide, and the \`#setup\` anchor renamed to \`#installation\`. No behavior changes; the anchor rename is the one thing to verify, because inbound links may use the old fragment.
{% /section %}
{% /group %}

{% group label="Full PR diff" %}
{% section id="files" title="Full PR diff" icon="file-diff" %}
{% files /%}
{% /section %}
{% /group %}`,
  },
];

/** The exemplars as one prompt or skill fragment. */
export const exemplarsText = AUTHORING_EXEMPLARS.map(
  ({ context, document }) => `${context}

${document}`,
).join("\n\n");
