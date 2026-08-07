# balade — agent instructions

`balade` renders a thin, committed walkthrough file into an interactive PR-review
app. Every design decision is locked on the spec map:
[basaltbytes/skills#1](https://github.com/basaltbytes/skills/issues/1). Do not
reopen map decisions in code; implementation trade-offs live in
[DECISIONS.md](DECISIONS.md) — read it before proposing a change, and record new
trade-offs there.

## Definition of done
When working on a feature/bugfix/refactoring you need to do the following before handing off to the user:
- always assume the code quality pipeline was fully green before your turn
- typecheck should still pass
- lint should still pass without lint ignore
- format should still pass
- tests should still pass without ignore (but keep big OS matrix tests for the CI run).
- documentation should be updated

## Rules

- Read [the coding-guidelines charter](.agents/skills/coding-guidelines/CODING_GUIDELINES.md)
  before writing code, and its
  [TypeScript mapping](.agents/skills/coding-guidelines/TYPESCRIPT.md) for the
  language rules. Reviews hunt violations against it. The charter is vendored
  from `basaltbytes/skills` — edit it there, not here.
- When writing Effect TypeScript code ALWAYS refer to the `/effect-ts` skill
- **`src/contract/types.ts` is the contract** between the CLI and every renderer
  (derived from `src/contract/schema.ts`). It changes only with a deliberate
  decision.
- `src/` follows a one-directional dependency law — folder-per-verb `commands/`
  boundary, autonomous concept modules. See the "src/ layout" entry in
  [DECISIONS.md](DECISIONS.md) before adding a file or an import.
- Chrome strings ship in `en` and `fr` (`app/src/i18n.ts`); never hardcode
  user-visible English in a component.
- Effect v4 beta APIs differ from v3 and from most published docs: verify
  against the installed `.d.ts` under `node_modules/effect/dist/`, never from
  memory. Versions are pinned exact; bump deliberately.
- Tests go through real seams (fixture git repos, injected stores); module
  mocking is forbidden.
- A PR that changes user-facing behavior adds a changeset (`pnpm changeset`):
  its release note becomes the CHANGELOG entry. Infra/docs-only PRs add none.
  Releasing is fully CI-driven — see [docs/releasing.md](docs/releasing.md);
  never bump versions by hand.

## Public state of the library: pre-alpha
- The library is not published anywhere, breaking changes are the norm, API is not finalized.
- Do not preserve backward compatibility. Remove obsolete paths instead of
adding compatibility layers, fallbacks or migrations.

## Commands

- `pnpm typecheck` — both projects (CLI + tests, then the app)
- `pnpm test` — vitest, CLI and app suites
- `pnpm lint` / `pnpm format:check` — oxlint / oxfmt
- `pnpm build` — CLI to `dist/`, SPA to `dist/app/`, export bundle to `dist/export/`
- `pnpm package:smoke` — packs the tarball and exercises the installed binary
