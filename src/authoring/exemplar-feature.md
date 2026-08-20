The pull request adds retry with exponential backoff to an upload queue: one new module, one changed caller, one test file.

{% group label="Overview" %}
{% section id="overview" title="Retry for failed uploads" icon="sync" %}
A failed chunk upload now retries up to three times with exponential backoff instead of failing the whole batch. The constraint that shapes the change: a retry must never reorder chunks within one file.

{% callout tone="key" %}
The retry counter lives on the queue entry, not on the connection, so a reconnect does not reset it.
{% /callout %}
{% /section %}
{% /group %}

{% group label="Retry mechanism" %}
{% section id="backoff" title="Backoff and give-up decisions" icon="iterations" related=["proof"] %}
`enqueue` tags every chunk with attempt 0. On failure, the delay doubles from a 500 ms base, and the fourth failure moves the chunk to the dead-letter list instead of the queue.

```pseudo
on chunk failure
  if attempts is 3
    move chunk to dead-letter
  else
    wait 500ms * 2^attempts
    requeue chunk, attempts + 1
```

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
{% /group %}
