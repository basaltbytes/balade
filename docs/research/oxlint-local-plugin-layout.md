# Local Oxlint plugin layout

Research into whether the former `tools/oxlint/anti-slop/` path was required by
Oxlint, and what layout fits a single repository-owned collection of custom
rules.

Sources were checked on 2026-08-17 against Oxlint 1.78.0 and primary material
only: the official Oxlint and Node.js documentation, the `oxc-project/oxc`
repository, and this repository's committed configuration and decisions.

## Verdict

This repository can use a regular `tools/oxlint/rules/` directory. Oxlint
does not prescribe a source-tree layout or require a directory named after the
plugin. It loads **one plugin entry module** from each `jsPlugins` specifier;
that module exports a plugin object whose `rules` property maps rule names to
implementations. A local specifier may be any valid import specifier and is
resolved relative to the config file. The official examples use individual
files such as `./plugin.js`, not a specially named folder
([using JS plugins](https://oxc.rs/docs/guide/usage/linter/js-plugins.html#using-js-plugins),
[writing JS plugins](https://oxc.rs/docs/guide/usage/linter/writing-js-plugins.html#eslint-compatible-api)).

The important distinction is:

- `tools/oxlint/rules/` can be the ordinary folder containing rule modules.
- `.oxlintrc.json` should still point to a concrete entry file such as
  `./tools/oxlint/plugin.ts`; Oxlint does not discover and register every file in
  a rules directory.

Because the repository is ESM, the explicit file is not merely a style choice.
Node's ESM resolver requires file extensions on relative imports and requires a
directory index to be fully specified
([Node.js ESM specifiers](https://nodejs.org/api/esm.html#mandatory-file-extensions)).
The same rule applies to native TypeScript execution: imports must say
`./file.ts`, not `./file`
([Node.js 22 TypeScript modules](https://nodejs.org/docs/latest-v22.x/api/typescript.html#determining-module-system)).

## What `anti-slop` meant before the move

The former name was used for three separate things:

1. the physical directory, `tools/oxlint/anti-slop/`;
2. the explicit `jsPlugins[].name` alias and therefore the
   `anti-slop/<rule>` config prefix;
3. the plugin's `meta.name` in its default-exported object.

Oxlint does not require those three names to be coupled. Its config reference
defines `jsPlugins[].specifier` as a path or package name and
`jsPlugins[].name` as a custom alias
([config reference](https://oxc.rs/docs/guide/usage/linter/config-file-reference.html#jspluginsn)).
The alias determines how rules are addressed in configuration, while the
specifier determines which module is loaded. Moving the module therefore does
not, by itself, require renaming the rule namespace.

The folder existed because the rules arrived together from an upstream source,
not because Oxlint required it. Anti-slop's own manual installation
guide gives `tools/oxlint/anti-slop/` as an **example** copy destination, then
says the project is meant to be vendored and the copied files are the consuming
team's to maintain and make its own
([pinned upstream README](https://github.com/dmmulroy/anti-slop/blob/446268e5d15baa968eaec669ff65358d36ae6259/README.md#manual-local-installation)).
Balade recorded the same ownership model: weakening, deleting, or updating a
rule is a local edit rather than a dependency-version negotiation
([current decision](../../DECISIONS.md#local-oxlint-rules-are-vendored-not-depended-on)).
That ownership makes an upstream-branded physical boundary optional, not a
constraint of either project.

## What Oxlint requires

Oxlint describes a plugin as a default-exported object containing `meta` and a
`rules` map. Its faster alternative API wraps that same object with
`eslintCompatPlugin`; this is already what balade does
([official authoring example](https://oxc.rs/docs/guide/usage/linter/writing-js-plugins.html#alternative-api)).
The `@oxlint/plugins` package's own README shows the same single-entry shape
with `definePlugin` or `eslintCompatPlugin`
([pinned Oxc source](https://github.com/oxc-project/oxc/blob/2f5cdb1231d217ba33d0c0ee777fa36095c939b4/npm/oxlint-plugins/README.md)).
Oxc's own test fixture keeps `plugin.ts` directly beside `oxlint.config.ts` and
loads that file explicitly; it is neither a package nor a specially named
plugin directory
([fixture config](https://github.com/oxc-project/oxc/blob/2f5cdb1231d217ba33d0c0ee777fa36095c939b4/apps/oxlint/test/fixtures/js_config_js_plugins/oxlint.config.ts),
[fixture plugin](https://github.com/oxc-project/oxc/blob/2f5cdb1231d217ba33d0c0ee777fa36095c939b4/apps/oxlint/test/fixtures/js_config_js_plugins/plugin.ts)).

Oxlint explicitly delegates the compatible plugin model to ESLint v9+. ESLint
likewise defines a plugin as one entry object with a `rules` property and a
default export; it does not impose the internal folder layout
([ESLint plugin structure](https://eslint.org/docs/latest/extend/plugins#create-a-plugin)).
For published plugins ESLint recommends package-oriented metadata and a default
package export, but those publication conventions do not make a nested package
appropriate for a repository-local plugin
([ESLint plugin metadata](https://eslint.org/docs/latest/extend/plugins#meta-data-in-plugins)).

TypeScript is valid for this local entry because Oxlint documents native `.ts`
plugin support on Node >=22.18.0, and balade requires Node >=22.22.2
([Oxlint config reference](https://oxc.rs/docs/guide/usage/linter/config-file-reference.html#jsplugins),
[Node.js 22 type stripping](https://nodejs.org/docs/latest-v22.x/api/typescript.html#type-stripping)).
No nested `package.json`, build output, or separately published plugin package
is needed. Balade's npm manifest publishes only `dist`, so `tools/` remains
development-only regardless of this move.

## Chosen layout for balade

Use one explicit local plugin module and put the implementation files directly
under the Oxlint tool boundary:

```text
tools/
└── oxlint/
    ├── plugin.ts
    ├── rules/
    │   ├── no-chained-type-assertions.ts
    │   ├── no-conditional-empty-object-spread.ts
    │   ├── ...
    │   └── require-safety-comment-for-type-assertion.ts
    └── shared/
        ├── dictionary-types.ts
        └── reflect-method.ts
```

Register the concrete entry module:

```json
{
  "jsPlugins": [
    { "name": "balade", "specifier": "./tools/oxlint/plugin.ts" }
  ],
  "rules": {
    "balade/no-module-mocking": "error"
  }
}
```

`balade` is the namespace because the repository owns the policy
and implementation now. `anti-slop` describes the rules' provenance and an
intentional historical framing; it is not a technical category required at
runtime. Provenance belongs in `DECISIONS.md` or a source comment, while the
runtime namespace should say who owns the rule set.

The same physical tree could have retained the `anti-slop` alias and
`meta.name`, because physical layout and rule namespace are independent. The
project-owned namespace was chosen so diagnostics identify the owner of the
active policy rather than the source from which it was copied.

A deeper layout such as `tools/oxlint/plugins/anti-slop/` becomes useful only
if the repository has multiple independently registered plugin entry modules,
or if one plugin is going to become a separately versioned package. Neither is
true here: the current tree has one entry module, one config registration, and
one team-owned rule collection. The extra named-plugin directory therefore
does not carry a distinct boundary.

## Applied migration

The physical and namespace cleanup required these changes:

1. Move `index.ts`, `rules/`, and `shared/` up one level, naming the entry
   `tools/oxlint/plugin.ts`. Its relative imports remain `./rules/...`.
2. Change `.oxlintrc.json`'s specifier to
   `./tools/oxlint/plugin.ts`.
3. Change the explicit plugin alias, plugin `meta.name`, and the fifteen config
   keys from `anti-slop/*` to `balade/*`. Oxlint permits the alias because
   `balade` is not one of its reserved native plugin names
   ([reserved names](https://oxc.rs/docs/guide/usage/linter/config-file-reference.html#jspluginsnname)).
4. Update the existing `DECISIONS.md` entry so the rules retain their upstream
   provenance while their path and namespace express local ownership.
5. Search for rule prefixes in config, inline disables, scripts, and docs. At
   the time of this research, repository references are limited to
   `.oxlintrc.json`, the plugin entry, `DECISIONS.md`, and the directory path;
   there are no inline `anti-slop/*` suppressions to migrate.
6. Run the normal quality pipeline. The path move does not change which files
   `oxlint .` checks or alter the TypeScript project boundaries recorded in
   `DECISIONS.md`; Oxlint still loads and exercises the plugin itself.

This is an internal tooling refactor, not a published or user-facing behavior
change, so it should not require a changeset. It also does not require changing
the rule implementations or the CLI/application contract.

## Result

`tools/oxlint/anti-slop/` was a local historical choice, not an Oxlint pattern.
The repository now uses
`tools/oxlint/plugin.ts` plus `tools/oxlint/rules/` and
`tools/oxlint/shared/`, with an explicit file specifier in `.oxlintrc.json`.
The `balade/*` namespace makes diagnostics match the ownership model recorded
in the repo.
