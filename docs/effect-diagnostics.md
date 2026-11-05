# Effect diagnostics backlog

`pnpm typecheck` runs the Effect-patched `tsc` from `@effect/tsgo` with the
configuration in `tsconfig.base.json`: 101 rules at `error`. The 32 rules
below also fail on the current code, so they are `off` there until each is fixed
and turned on. Measured on `@effect/tsgo` 0.64.1 with `effect` 4.1.2:
998 diagnostics. `src/` and `test/` are the CLI project, `app/` the renderer.

| Rule | src | test | app | Autofix via `effect-tsgo oxlint` |
|---|---|---|---|---|
| `newSchemaClass` | 155 | 38 | 43 | yes |
| `asyncFunction` | 21 | 39 | 86 |  |
| `schemaClassMissingBrand` | 88 | 3 | 25 |  |
| `strictBooleanExpressions` | 2 | 0 | 88 |  |
| `yieldInCallArgument` | 28 | 36 | 22 |  |
| `nodeBuiltinImport` | 8 | 57 | 2 |  |
| `globalJson` | 15 | 40 | 7 |  |
| `globalJsonInEffect` | 10 | 33 | 9 |  |
| `schemaSync` | 3 | 18 | 0 |  |
| `strictEffectProvide` | 2 | 0 | 16 |  |
| `newPromise` | 0 | 6 | 11 |  |
| `preferTypedSchemaDecoder` | 1 | 11 | 1 | yes |
| `globalTimers` | 1 | 4 | 6 |  |
| `globalDate` | 2 | 4 | 3 |  |
| `missedPipeableOpportunity` | 8 | 0 | 0 | yes |
| `preferSucceedSomeOrNone` | 2 | 5 | 0 | yes |
| `mapSomeToAsSome` | 3 | 0 | 1 | yes |
| `processEnv` | 0 | 4 | 0 |  |
| `processEnvInEffect` | 1 | 3 | 0 |  |
| `unnecessaryArrowBlock` | 2 | 0 | 1 | yes |
| `globalDateInEffect` | 1 | 2 | 0 |  |
| `preferBarrelImport` | 3 | 0 | 0 |  |
| `instanceOfSchema` | 0 | 2 | 1 |  |
| `mapMapErrorToMapBoth` | 3 | 0 | 0 | yes |
| `globalFetch` | 0 | 2 | 0 |  |
| `extendsNativeError` | 0 | 0 | 2 |  |
| `effectTryWithoutCatch` | 2 | 0 | 0 |  |
| `globalTimersInEffect` | 2 | 0 | 0 |  |
| `flatMapConditionalToFilterOrFail` | 0 | 0 | 1 |  |
| `globalRandom` | 0 | 1 | 0 |  |
| `allOfMapToForEach` | 1 | 0 | 0 |  |
| `anyUnknownInErrorContext` | 0 | 1 | 0 |  |

## Order

1. The rules with an autofix, one rule per PR: an `effecttsgo` rule config and
   `effect-tsgo oxlint --type-aware --fix-suggestions`, then `pnpm format`.
2. `schemaClassMissingBrand` (the brand type argument on every
   `Schema.TaggedError`, `Schema.Class` and `Context.Service`) and
   `yieldInCallArgument`.
3. The renderer: decide whether `asyncFunction`, `globalJson`, `globalDate`,
   `globalTimers`, `newPromise` and `strictBooleanExpressions` apply to React
   code in `app/`, or add a path override turning them off there.
4. The remaining CLI rules (`nodeBuiltinImport`, `globalJson*`, `schemaSync`,
   `strictEffectProvide`, `instanceOfSchema`, ...).

Turning a rule on means deleting its `off` line in `tsconfig.base.json`; the
shared config applies to the CLI, the tests, the renderer and the package
builds.
