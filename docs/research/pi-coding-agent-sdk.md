# Pi coding-agent SDK — claim verification

Verification of the factual claims in the issue proposing draft-walkthrough
generation via the Pi coding-agent SDK.

Sources checked on 2026-08-02, against primary material only:

- Source: `github.com/earendil-works/pi` at commit `4c01c709380621c5ff2719162cd7a7973dcb2799`
  (default branch `main`). The issue's link `github.com/badlogic/pi-mono` is a
  301 redirect to this repo — the project moved org and dropped the `-mono` name.
- npm: `@earendil-works/pi-*` packages, all at 0.83.0 (published 2026-07-29).
  The former `@mariozechner/pi-coding-agent` is deprecated at 0.73.1 with the
  message "please use @earendil-works/pi-coding-agent instead going forward".

File paths below are relative to the repo root at that commit.

## TL;DR verdicts

| # | Claim | Verdict | Primary source |
|---|-------|---------|----------------|
| 1 | Login with Anthropic Claude Pro/Max or OpenAI ChatGPT Plus/Pro subscription | **Verified, with a major billing caveat on Anthropic** | `packages/ai/src/auth/oauth/anthropic.ts`, `.../openai-codex.ts`, `packages/coding-agent/docs/providers.md` |
| 2 | Pi owns credentials in its own store; embedding apps can reuse them | **Verified** (plain file, not keychain) | `packages/coding-agent/src/core/auth-storage.ts`, `src/config.ts`, `docs/sdk.md` |
| 3 | Queryable model registry | **Verified** | `packages/ai/src/models.ts` (`Models` interface), `packages/coding-agent/src/core/model-runtime.ts`, `.../model-registry.ts` |
| 4 | Embeddable as a TypeScript library, no shelling out | **Verified** | `packages/coding-agent/docs/sdk.md`, `examples/sdk/*`, npm `@earendil-works/pi-coding-agent` 0.83.0 |
| 5 | Practical integration constraints | **Facts gathered** — Node >=22.19.0 (balade declares >=20), ESM-only, 0.x with routine breaking changes | package.json of each package, `CHANGELOG.md` |

## 1. Subscription auth

**Supported providers.** `packages/coding-agent/docs/providers.md` ("Subscriptions")
lists OAuth subscription login for: ChatGPT Plus/Pro (Codex), Claude Pro/Max,
GitHub Copilot, xAI (Grok/X subscription), OpenRouter, Radius. The
implementations live in `packages/ai/src/auth/oauth/` — `anthropic.ts`,
`openai-codex.ts`, `github-copilot.ts`, `xai.ts`, `openrouter.ts`, `radius.ts`,
`kimi-coding.ts`.

**Implementing package.** `@earendil-works/pi-ai` (the model/auth layer), not
the coding-agent package. The coding agent composes it via `ModelRuntime`.

**Flow mechanics** (from source):

- Anthropic (`auth/oauth/anthropic.ts`): PKCE browser flow against
  `https://claude.ai/oauth/authorize`, token exchange at
  `https://platform.claude.com/v1/oauth/token`, loopback callback on port
  53692 with a manual code-paste fallback for headless machines. The client id
  is a hardcoded constant, base64-obfuscated in source (decodes to
  `9d1c250a-e61b-44d9-88ed-5944d1962f5e`); requested scopes include
  `user:inference` and `user:sessions:claude_code`.
- OpenAI Codex (`auth/oauth/openai-codex.ts`): PKCE browser flow against
  `https://auth.openai.com/oauth/authorize` (callback port 1455) or a
  device-code flow; client id `app_EMoamEEZ73f0CkXaXp7hrann`.

**Login entry points:**

- Interactive CLI: `/login` slash command inside `pi` (provider picker), `/logout`
  to clear (`docs/providers.md`; wired in
  `packages/coding-agent/src/modes/interactive/interactive-mode.ts`). There is
  no non-interactive `pi login` subcommand in `main.ts`.
- Standalone CLI: `npx @earendil-works/pi-ai login [provider]` — but note this
  saves `auth.json` **in the current directory**, not `~/.pi/agent/`
  (`packages/ai/README.md`, "CLI Login").
- Programmatic: `Models.login(providerId, type, interaction)` /
  `ModelRuntime.login(...)` with an `AuthInteraction` callback object
  (`prompt()` for text/secret/select/manual-code prompts, `notify()` for
  auth-URL and device-code events) — `packages/ai/src/auth/types.ts`,
  `packages/coding-agent/src/core/model-runtime.ts:519`. So an embedding app
  can drive the whole OAuth flow with its own UI.

**Terms-of-service caveats — where the issue over-claims:**

- Anthropic: pi's own docs state "Anthropic subscription auth is active for
  Claude Pro/Max accounts. Third-party harness usage draws from
  [extra usage](https://claude.ai/settings/usage) and is billed per token, not
  against Claude plan limits" (`docs/providers.md`). This matches Anthropic's
  February 2026 policy change (effective 2026-04-04) that blocked subscription
  OAuth from drawing on plan allowances in third-party harnesses; usage is
  pay-as-you-go "extra usage" billed to the Claude account (secondary
  coverage: [The Register](https://www.theregister.com/software/2026/02/20/anthropic-clarifies-ban-on-third-party-tool-access-to-claude/5014546),
  [alternativeto.net](https://alternativeto.net/news/2026/2/anthropic-officially-bans-using-subscription-authentication-for-third-party-claude-use);
  Anthropic's own support page sits behind login). So "use your Claude Pro/Max
  subscription" is true for *login* but not for *plan-included usage*: it is
  per-token billing through the subscription account.
- OpenAI: pi's docs say Codex subscription auth is "Officially endorsed by
  OpenAI" and link the [Codex for OSS](https://developers.openai.com/community/codex-for-oss)
  program page. That page names pi explicitly among tools the program supports
  ("developers should code in the tools they prefer, whether that's Codex,
  OpenCode, Cline, pi, OpenClaw, or something else"), but it does not spell
  out subscription-OAuth terms; the endorsement claim is pi's gloss on it.

## 2. Credential store

**Verified.** Location: `~/.pi/agent/auth.json` — a plain JSON file, not a
keychain. `packages/coding-agent/src/config.ts` (`getAgentDir()` →
`~/.pi/agent`, `getAuthPath()` → `auth.json` there).
`packages/coding-agent/src/core/auth-storage.ts` writes it with mode `0600`
(directory `0700`) and serializes cross-process access with `proper-lockfile`.

**API surface:**

- `CredentialStore` interface (`packages/ai/src/auth/credential-store.ts`,
  `auth/types.ts`): `read(providerId)`, `list()` (non-secret metadata),
  `modify(providerId, fn)` (the only write path; OAuth refresh runs inside it
  under the lock so concurrent processes cannot double-refresh), and
  `delete(providerId)`. Credentials are type-tagged
  `{ type: "api_key" } | { type: "oauth", access, refresh, expires }`, one per
  provider id.
- `readStoredCredential(providerId, authPath?)` — exported one-shot file read
  (`packages/coding-agent/src/core/auth-storage.ts:329`).
- `ModelRuntime.create()` defaults to `~/.pi/agent/auth.json` and
  `~/.pi/agent/models.json` (`docs/sdk.md`, "API Keys and OAuth"), so **an
  embedding app reuses a login performed by the pi CLI with zero configuration**.
  `authPath` / `credentials` options redirect storage
  (`CreateModelRuntimeOptions`, `model-runtime.ts:58`); `pi-ai` ships
  `InMemoryCredentialStore` as an injectable non-persistent implementation.
- Resolution order (documented in `docs/sdk.md`): runtime overrides
  (`setRuntimeApiKey`, not persisted) → stored `auth.json` credentials → env
  vars (`ANTHROPIC_API_KEY`, …) → fallback resolver for custom providers. A
  stored credential *owns* its provider — env vars are consulted only when
  nothing is stored (`packages/ai/README.md`, "Credential Store").

## 3. Model registry

**Verified.** Two layers:

- `@earendil-works/pi-ai` `Models` interface (`packages/ai/src/models.ts:127`):
  `getProviders()`, `getProvider(id)`, `getModels(provider?)`,
  `getModel(provider, id)`, `getAvailable(providerId?)` (only models with
  complete auth), `checkAuth(providerId)`, `refresh()` for dynamic catalogs,
  plus `stream`/`complete`/`streamSimple`/`completeSimple` and
  `login`/`logout`. Built-in catalogs are generated
  (`models.generated.ts`); `builtinModels()` from
  `@earendil-works/pi-ai/providers/all` registers every provider, or register
  individual provider factories for smaller bundles.
- `@earendil-works/pi-coding-agent` `ModelRuntime` (implements `Models`,
  `core/model-runtime.ts`) adds `auth.json`/`models.json` wiring, custom
  models from `~/.pi/agent/models.json`, catalog caching in
  `~/.pi/agent/models-store.json`, and `setRuntimeApiKey`. `ModelRegistry`
  (`core/model-registry.ts`) is a synchronous facade for extensions
  (`getAll()`, `getAvailable()`, `find(provider, id)`,
  `hasConfiguredAuth(model)`). Model helpers: `calculateCost()`, `hasApi()`
  type guard, thinking-level utilities (`models.ts`).

## 4. Embeddable as a library

**Verified.** Package: `@earendil-works/pi-coding-agent` 0.83.0
([npm](https://www.npmjs.com/package/@earendil-works/pi-coding-agent), MIT).
The SDK is inside the main package — "no separate installation needed"
(`docs/sdk.md`). The README describes four run modes: interactive, print/JSON,
RPC, and "an SDK for embedding in your own apps".

**Session/agent API** (`docs/sdk.md`; exports in
`packages/coding-agent/src/index.ts`):

- `createAgentSession()` → `AgentSession`: `prompt(text)`, `steer()`,
  `followUp()`, `subscribe(listener)` for streaming events
  (`message_update` with `text_delta` etc.), `setModel()`, `compact()`,
  `abort()`, `dispose()`. `AgentSessionRuntime` adds new/resume/fork/import.
- System-prompt injection: `DefaultResourceLoader` with
  `systemPromptOverride` / `appendSystemPromptOverride`
  (`examples/sdk/03-custom-prompt.ts`).
- Tool control: `tools: ["read", "bash"]` allowlists; factories
  (`createCodingTools`, `createReadOnlyTools`, per-tool `create*Tool`) with
  injectable `*Operations` interfaces; custom tools via `defineTool` with
  TypeBox schemas.
- Sessions: `SessionManager.inMemory()` or file-backed session trees.
- 13 runnable examples in `packages/coding-agent/examples/sdk/`
  (01-minimal through 13-session-runtime).
- Plain completion without the agent loop: `@earendil-works/pi-ai`
  `models.complete(model, context)` / `streamSimple` — `Context` is
  `{ systemPrompt, messages, tools }`, plain serializable data
  (`packages/ai/README.md`, "Quick Start").

**Packages on npm** (all 0.83.0, MIT, lockstep-versioned):
`@earendil-works/pi-coding-agent` (bin `pi`; unpacked ~13.1 MB),
`@earendil-works/pi-ai` (bin `pi-ai`; ~3.7 MB), `@earendil-works/pi-agent-core`
(~1.4 MB), `@earendil-works/pi-tui` (~1.8 MB). The workspace packages
`pi-client`, `pi-protocol`, `pi-server` are **not published**; the published
coding-agent tarball's dependency list omits them (their RPC/client code ships
inside the package) and pins its full transitive tree with an
`npm-shrinkwrap.json`.

**Dependency weight:** `pi-ai` depends on the official provider SDKs
(`@anthropic-ai/sdk`, `openai`, `@google/genai`, `@mistralai/mistralai`,
`@aws-sdk/client-bedrock-runtime`). `pi-coding-agent` adds `chalk`,
`highlight.js`, `undici`, `jiti`, `proper-lockfile`, and
`@silvia-odwyer/photon-node` (WASM image codec — loaded lazily via dynamic
import, `src/utils/image-convert.ts`). No native/node-gyp modules.

**Stability:** 0.x versioning; the changelog carries "Breaking Changes"
sections routinely, including in 0.83.0 itself (`CHANGELOG.md`). No published
semver-stability promise for the SDK surface was found. Release cadence is
active (repo pushed 2026-08-02; 82k+ GitHub stars).

## 5. Practical integration notes (facts)

- **Node**: `engines.node >= 22.19.0` on every published package. balade's
  `package.json` currently declares `engines.node >= 20`.
- **Module format**: ESM-only (`"type": "module"`, `exports` maps expose only
  `import`/`types` conditions — no CJS). Bun is also supported (dedicated
  `bun-oauth` entry, `src/bun/`).
- **TUI coupling**: the root barrel (`src/index.ts`) re-exports interactive
  components (`LoginDialogComponent`, theme utilities, …), so importing
  `@earendil-works/pi-coding-agent` loads TUI modules at import time. `pi-tui`
  is pure JS with two deps (`marked`, `get-east-asian-width`); the only WASM
  (photon) loads lazily. The package has just three export paths: `.`,
  `./rpc-entry`, `./client` — there is no TUI-free SDK subpath.
- **Error surfaces**:
  - `pi-ai` request paths never throw out of stream functions: failures
    (including aborts and auth failures) surface as an `error` stream event
    and a final `AssistantMessage` with `stopReason: "error" | "aborted"` plus
    `errorMessage` (`packages/ai/README.md`, "Error Handling").
  - `Models.getAuth()` rejects with `ModelsError` (an `Error` subclass with a
    `.code`: `"oauth"` for failed token refresh — stored credential preserved
    for retry — `"auth"` for key-resolution/store failures)
    (`packages/ai/src/auth/resolve.ts:24`, `models.ts` doc comments).
  - `AgentSession.prompt()` resolves normally; agent-level failures arrive as
    `agent_end` events carrying `errorMessage`, with `auto_retry_*` events for
    retries (`core/agent-session.ts`). `prompt()` throws only when called
    mid-stream without a `streamingBehavior` option (`docs/sdk.md`).
- **Test seams (no module mocking needed)**: `fauxProvider()` — a scriptable
  fake provider with `setResponses`/`appendResponses`
  (`packages/ai/src/providers/faux.ts`); `InMemoryCredentialStore`;
  `InMemoryModelsStore`; `SessionManager.inMemory()`; injectable
  `ResourceLoader`; tool `*Operations` interfaces; `ModelRuntime.create()`
  accepts injected `credentials`/`modelsStore` and defaults to
  network-refresh-off (`allowModelNetwork: false`).
- **Config isolation**: everything under `~/.pi/agent/` (`auth.json`,
  `models.json`, `settings.json`, `sessions/`, `models-store.json`);
  `CreateModelRuntimeOptions.authPath`/`modelsPath` and `createAgentSession`
  directory options redirect all of it, so an embedding app can run fully
  isolated or deliberately share the user's existing pi login.
