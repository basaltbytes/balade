---
walkthrough: 1
title: Add live planning pool items
pr: 42
commit: __COMMIT__
meta:
  module: acme_planning
  lang: en
---

{% group label="Orientation" %}

{% section id="overview" title="Overview" icon="list-unordered" %}

Adds `planning.pool.item`, a read-only lens over **converted** allocations. It keeps
allocation grain and exposes *total*, *placed* and *remaining* charge.

### What it does not do

- It never creates shifts on its own.
- It stores no number it can recompute.

{% cards cols=2 %}
{% card icon="database" title="One new model" %}
The pool item is a **derived** reading, never a table.
{% /card %}
{% card icon="beaker" title="Four tests" %}
They cover the grain and the live recomputation.
{% /card %}
{% /cards %}

{% callout tone="key" %}
**Shared pool** is the team's name for confirmed-but-unscheduled work.
{% /callout %}

{% /section %}

{% section id="map" title="Model map" icon="git-branch" %}

{% diagram intro="Click a box to jump to its detail card." hint="The thick arrow is the engine of this PR." nodes=[{id: "n-pool", model: "planning.pool.item", change: "new", badge: "new", ref: "m-pool", col: 1, row: 1, compartments: [{label: "SQL view", rows: ["allocation_id", "placed"]}]}, {id: "n-slot", model: "planning.slot", change: "mod", col: 2, row: 1, compartments: []}] edges=[{from: "n-slot", to: "n-pool", kind: "new", label: "allocation_id", thick: true}] /%}

{% /section %}

{% /group %}

{% group label="Models" %}

{% section id="m-pool" title="planning.pool.item" file="models/planning_pool_item.py" badge="new model" %}

{% attrs items=["_name = planning.pool.item", "_auto = False"] /%}

{% code file="models/planning_pool_item.py" from=1 to=16 mark="7" expect="from odoo import api" /%}

{% fields %}
{% field name="name" kind="Char" badges=["computed"] tags=["index=True"] %}
Human label for the pool row.
{% /field %}
{% field name="total" kind="Float" %}
Charge to schedule, read from the allocation.
{% /field %}
{% /fields %}

{% method sig="_compute_placed()" decorator="@api.depends(\"slot_ids.allocated_hours\")" %}
Sums the hours of every non-cancelled linked slot.
{% /method %}

{% /section %}

{% /group %}

{% group label="Quality" %}

{% section id="security" title="Security" icon="shield-lock" %}

Two layers, both read-only.

{% matrix %}
| ACL · group | read | write | create | unlink |
| ----------- | ---- | ----- | ------ | ------ |
| pool · user | ✓    | —     | —      | —      |
{% /matrix %}

| File | Intent |
| ---- | ------ |
| `ir.model.access.csv` | read-only access |

{% /section %}

{% section id="tests" title="Tests" icon="beaker" %}

{% tests %}
{% test name="test_pool_grain" kind="unit" asserts=["One row per allocation.", "Cancelled allocations produce nothing."] %}
Creates allocations in every state, then reads the pool view.
{% /test %}
{% /tests %}

{% /section %}

{% section id="i18n" title="Translations" icon="globe" %}

Every new label shipped with its French translation.

{% i18n /%}

{% /section %}

{% section id="patterns" title="Patterns worth stealing" icon="light-bulb" %}

{% patterns %}
{% pattern icon="database" term="SQL-view model" ref="planning_pool_item.py" %}
`_auto = False` plus `init()`: a model that is a query, not a table.
{% /pattern %}
{% /patterns %}

{% files only="docs/**" why={"docs/old.md": "superseded by the pool item"} /%}

{% /section %}

{% section id="files" title="Files changed" icon="file-diff" %}

{% files /%}

{% /section %}

{% /group %}
