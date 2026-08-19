---
"balade": minor
---

Name walkthrough groups from the change instead of the canonical skeleton.

The skeleton's five narrative names — Orientation, Mechanism, Models, Surface,
Quality — shipped as `{% group %}` wrappers inside the section templates, so the
model copied them verbatim into every walkthrough. A pull request that carried
no domain models still got a Models heading, and a heading sat above a single
section whatever that section was about.

The package now teaches those five as roles the author selects from, not as
headings. The narrative templates carry no group wrapper; the author gathers the
sections that share a subject under one group named from the change, the way the
closing diff's `{% filegroup /%}` children are already named, and a subject with
one section carries no group header at all. The closing Full PR diff group keeps
its fixed name.

Authoring package 1.24.0.
