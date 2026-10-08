---
walkthrough: 1
title: Pi SDK 1.1.0 and transcript-aware test harness
pr: 159
commit: e94c591885ec528c31791c0ab3e4a9c91dd1b78b
meta:
  lang: en
  scope: Pi SDK upgrade
  balade-authoring: 1.33.0
---

{% group label="Overview" %}
{% section id="overview" title="Pi 1.1.0 upgrade" icon="package" %}
This PR exact-pins the Pi AI and coding-agent packages at 1.1.0 and regenerates their dependency graph. The existing runtime still gets its model list from Pi, so the upgraded bundled catalog flows into the model picker and explicit `--model` resolution without a production source change.

The only code adaptation is in fake-provider tests. Pi now supplies a `TranscriptContext`, where the active system prompt and tools are derived from the message transcript instead of direct context fields. The tests now use Pi's transcript helpers and retain their existing security and generation assertions. The PR also records the compatibility review and adds a patch changeset.
{% /section %}
{% /group %}

{% group label="Pi 1.1.0" %}
{% section id="catalog" title="The SDK supplies the model catalog" icon="package" related=["transcript-context"] %}
Both direct Pi dependencies move together from 0.83.0 to exact 1.1.0 pins.

{% code file="package.json" from=67 to=70 expect="  \"dependencies\": {" /%}

The adapter already calls `ModelRuntime.getAvailable()`, maps Pi's provider and model identifiers into `AuthorModel` values, and sorts the result for display. It does not keep a local model allowlist. This is why a dependency-only change can expose the new Anthropic and GPT model families to both the picker and `--model`.

{% code file="src/pi/client.ts" from=141 to=167 expect="      const availableModels = Effect.gen(function* () {" /%}

The lockfile resolves the full Pi 1.1.0 package family and updates provider SDKs such as Anthropic, AWS Bedrock, Google, and OpenAI. Review `pnpm-lock.yaml` as a supply-chain change, not only as version metadata. The resolved Pi packages retain the Node `>=22.19.0` engine requirement.

The research note records the version-to-version compatibility check and identifies the transcript API as the one breaking change that reaches this repository.

{% code file="docs/research/pi-coding-agent-sdk.md" from=23 to=31 expect="Rechecked on 2026-10-08 when balade moved from the 0.83.0 pin to 1.1.0" /%}

A patch changeset communicates the SDK and model-catalog update to package consumers.
{% /section %}

{% section id="transcript-context" title="Fake providers read active transcript state" icon="beaker" related=["catalog"] %}
Pi 1.1.0 no longer exposes `context.tools` or `context.systemPrompt` as the current provider state. The fake response callbacks keep serializing `context.messages`, but now derive the active tool list from those messages with `getCurrentTools()`.

{% code file="test/generate.test.ts" from=183 to=190 expect="        (context) => {" /%}

System-prompt checks use the matching `getCurrentSystemPrompt()` helper. This keeps the tests aligned with Pi's transcript semantics while preserving the assertions about which repository instructions enter the authoring prompt.

{% code file="test/generate.test.ts" from=461 to=468 expect="      let systemPrompt = \"\";" /%}

The library-entry test applies the same extraction to both generated sessions, so its changed-instruction policy is still checked against the effective prompt rather than a removed context property.

{% code file="test/library.test.ts" from=103 to=113 expect="        const systemPrompts: string[] = [];" /%}

{% tests %}
{% test name="Pinned source and tool boundary" kind="unit" ref="test/generate.test.ts" asserts=["keeps pinned source and excludes working-tree content", "omits credential contents", "exposes only the authoring tool allowlist"] %}The callback derives the current tools from transcript messages before the existing request assertions run.{% /test %}
{% test name="Pinned instruction selection" kind="unit" ref="test/generate.test.ts" asserts=["includes applicable pinned instructions", "excludes working-tree and unrelated instructions", "keeps trusted changed instructions during repair"] %}The effective system prompt now comes from `getCurrentSystemPrompt(messages)` in both initial and repair flows.{% /test %}
{% test name="Library generation policy" kind="unit" ref="test/library.test.ts" asserts=["omits changed instructions by default", "still generates and reports progress", "keeps replacement behavior"] %}Both fake-provider calls use the transcript helper; the public library behavior and assertions are unchanged.{% /test %}
{% /tests %}
{% /section %}
{% /group %}

{% group label="Full PR diff" %}
{% section id="full-pr-diff" title="Full PR diff" icon="git-pull-request" %}
{% files /%}
{% /section %}
{% /group %}
