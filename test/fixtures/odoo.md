---
walkthrough: 1
title: Odoo preset
pr: 42
commit: __COMMIT__
preset: odoo
meta:
  module: acme_planning
---

{% section id="m-pool" title="planning.pool.item" file="models/planning_pool_item.py" %}

{% fields %}
{% o-field name="allocation_id" kind="Many2one" comodel="planning.allocation" readonly=true %}
The source row this lens reflects.
{% /o-field %}
{% o-field name="slot_ids" kind="One2many" %}
The slots that drain the pool.
{% /o-field %}
{% o-field name="name" kind="Char · compute" %}
Human label.
{% /o-field %}
{% /fields %}

{% method sig="_compute_placed()" decorator="@api.depends(\"slot_ids.allocated_hours\")" %}
Sums the hours of every linked slot.
{% /method %}

{% /section %}
