---
walkthrough: 1
title: Run the CLI shell through Effect services
pr: 12
commit: 6fadcb124126
meta:
  phase: services and layers
  scope: CLI and served mode
---

{% group label="Orientation" %}

{% section id="overview" title="One dependency graph, two lifetimes" icon="git-branch" %}

Platform I/O now enters through Effect services. The process-wide layer owns Node's
filesystem and path implementations, command execution, and PR location; repository
selection then supplies the root-bound services used by a served session.

{% flow %}
{% step tag="process" %}parse the CLI command{% /step %}
{% step tag="shared" %}provide `cliLayer`{% /step %}
{% step tag="selection" %}resolve the repository and walkthroughs{% /step %}
{% step tag="session" %}build the repository, cache, and review-state layers{% /step %}
{% step tag="scope" %}serve the API while its watcher remains in scope{% /step %}
{% /flow %}

{% callout tone="key" %}
The split follows runtime ownership: host capabilities live for the command, while
repository services exist only after `open` knows which root it will serve.
{% /callout %}

{% code file="src/live.ts" from=1 to=12 mark="9,12" view="diff" expect="/** Live dependency graph" /%}

{% /section %}

{% section id="path-identity" title="Repository paths survive Windows short names" file="src/resolve/paths.ts" badge="cross-platform" badgeTone="mod" relatedFiles=["test/paths.test.ts"] %}

Git can report the long repository path while Windows gives the file watcher an 8.3
short-name path such as `RUNNER~1`. If a lexical relative path appears to escape the
root, `repoRelative` now walks the file's ancestors and compares filesystem identity.

{% code file="src/resolve/paths.ts" from=19 to=37 mark="24-35" view="diff" expect="export const repoRelative" /%}

The regression test gives the long and short spellings the same device and inode. It
also keeps a genuinely external file as a lexical climb, preserving the prior result
outside the repository.

{% code file="test/paths.test.ts" from=25 to=46 mark="27-30,34-45" view="diff" expect="const testLayer" /%}

{% /section %}

{% /group %}

{% group label="Shell boundaries" %}

{% section id="command-executor" title="Command execution becomes a service" file="src/resolve/exec.ts" badge="service" badgeTone="mod" %}

Git and GitHub calls still use the established synchronous process adapter, but the
resolver no longer owns `node:child_process`. `CommandExecutor` carries that boundary;
the small `exec`, `gitOut`, and `gh` functions only request the service.

{% code file="src/resolve/exec.ts" from=38 to=86 mark="47-50,56-61,79-86" view="diff" expect="export interface CommandExecutorShape" /%}

This keeps process behavior unchanged while giving the rest of the shell one typed
dependency that a layer can replace.

{% /section %}

{% section id="session-layers" title="A session assembles root-bound services once" file="src/server/session.ts" badge="composition root" badgeTone="mod" relatedFiles=["src/server/repo.ts", "src/server/cache.ts", "src/state/store.ts", "src/server/api.ts"] %}

`prepareSession` waits for selection before creating `ServerRepo`, `PayloadCache`, and
`ReviewStateStore`. The API then reads those services from context, and the merged
session layer closes over the selected repository root.

{% code file="src/server/session.ts" from=126 to=157 mark="131-139,145-156" view="diff" expect="export const prepareSession" /%}

The cache itself now has a service contract. It retains one slot per walkthrough and
keeps the existing `(sourcePath, pin, head)` key, so the service migration doesn't
alter when a payload recompiles.

{% code file="src/server/cache.ts" from=13 to=58 mark="21-29,35-49,52-56" view="diff" expect="export interface PayloadCacheShape" /%}

{% /section %}

{% /group %}

{% group label="Resource lifecycle" %}

{% section id="scoped-watcher" title="The watcher belongs to the session scope" file="src/server/session.ts" badge="scoped resource" badgeTone="mod" %}

Each watched directory now produces a `FileSystem.watch` stream. The session forks
that stream with `Effect.forkScoped`, which ties interruption and OS watcher cleanup
to scope closure instead of exposing a manual `close()` method on `Session`.

{% code file="src/server/session.ts" from=172 to=201 mark="180-182,189-199" view="diff" expect="/**" /%}

Every event clears the served walkthroughs in that directory. Editors often save by
renaming a temporary file over the original, so directory-wide invalidation avoids
depending on filename details that differ between operating systems.

{% /section %}

{% /group %}

{% group label="Tests" %}

{% section id="test-seams" title="Tests provide layers through real seams" icon="beaker" relatedFiles=["test/support/effect.ts", "test/server.test.ts"] %}

Fixture-repository tests use the same live shell graph as the CLI. Focused cache tests
supply a `ServerRepo` layer directly, which checks the service boundary without module
patching or process stubs.

{% code file="test/support/effect.ts" from=1 to=7 mark="4,6-7" view="diff" expect="/** The production shell layer" /%}

{% code file="test/server.test.ts" from=388 to=426 mark="392-404,406-425" view="diff" expect="it.effect(\"resolves once per key" /%}

{% tests %}
{% test name="cache key and explicit invalidation" kind="unit" ref="test/server.test.ts" asserts=["The same pin and HEAD compile once.", "A changed HEAD or pin recompiles.", "Watcher invalidation removes the settled slot."] %}
The fake repository lives in a `Layer.succeed(ServerRepo, …)` value, exactly where the
production cache expects its dependency.
{% /test %}
{% test name="scoped watcher refresh" kind="unit" ref="test/server.test.ts" asserts=["Editing a served walkthrough refreshes its cached payload.", "The test keeps the stamp and HEAD fixed, isolating watcher invalidation.", "Fixture cleanup runs as a scope finalizer."] %}
The integration test edits the walkthrough title after the first request and polls the
same API until the new payload appears.
{% /test %}
{% /tests %}

{% code file="test/server.test.ts" from=104 to=145 mark="111-125,135-142" view="diff" expect="it.live(\"invalidates a cached payload" /%}

{% /section %}

{% section id="changed-files" title="Changed files" icon="file-diff" %}

{% files /%}

{% /section %}

{% /group %}
