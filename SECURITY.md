# Security

## Reporting a vulnerability

Open an issue at
[basaltbytes/balade/issues](https://github.com/basaltbytes/balade/issues) with
the `security` label.

For anything you would rather not post publicly, send a direct message to
[@_philDL](https://x.com/_philDL) on X and we will take it from there.

Useful things to include: what an attacker controls, what they get, and the
smallest input that shows it. A pull request URL or a walkthrough file that
reproduces the behaviour is worth more than a description.

## Scope

balade reads a pull request and renders it for review, so the interesting
surfaces are the ones where pull-request content reaches a reviewer:

- the review app's rendering of walkthrough and diff content
- the authoring agent's prompt and its read-only tool surface
- the local review server on `127.0.0.1`
- the standalone HTML export produced by `balade build`
- the CLI's use of `git` and `gh`

[docs/threat-model.md](docs/threat-model.md) describes the trust boundaries in
detail, including the invariants the code holds today. Reading it first will
tell you whether something is a finding or a documented position.

## Supported versions

balade is pre-alpha and moves fast. Fixes land on the latest published version
on npm; there are no backported releases.
