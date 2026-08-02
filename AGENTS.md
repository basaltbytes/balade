# balade — agent instructions

`balade` renders a thin, committed walkthrough file into an interactive PR-review
app. Every design decision is locked on the spec map:
[basaltbytes/skills#1](https://github.com/basaltbytes/skills/issues/1). Do not
reopen map decisions in code; implementation trade-offs live in
[DECISIONS.md](DECISIONS.md) — read it before proposing a change, and record new
trade-offs there.

## Rules

- Read [guidelines/CODING_GUIDELINES.md](guidelines/CODING_GUIDELINES.md)
  before writing code, and [guidelines/TYPESCRIPT.md](guidelines/TYPESCRIPT.md)
  for the language mapping. Reviews hunt violations against it.
- When writing Effect TypeScript code ALWAYS refer to the `/effect-ts` skill
- **`src/payload/types.ts` is the contract** between the CLI and every renderer.
  It stays plain interfaces and changes only with a deliberate decision.
- Chrome strings ship in `en` and `fr` (`app/src/i18n.ts`); never hardcode
  user-visible English in a component.
- Effect v4 beta APIs differ from v3 and from most published docs: verify
  against the installed `.d.ts` under `node_modules/effect/dist/`, never from
  memory. Versions are pinned exact; bump deliberately.
- Tests go through real seams (fixture git repos, injected stores); module
  mocking is forbidden.

## Commands

- `pnpm typecheck` — both projects (CLI + tests, then the app)
- `pnpm test` — vitest, CLI and app suites
- `pnpm lint` / `pnpm format:check` — oxlint / oxfmt
- `pnpm build` — CLI to `dist/`, SPA to `dist/app/`, export bundle to `dist/export/`
- `pnpm package:smoke` — packs the tarball and exercises the installed binary
