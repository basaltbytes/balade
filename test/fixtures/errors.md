---
walkthrough: 1
title: Planted errors
pr: 42
commit: __COMMIT__
module: acme_planning
---

{% section id="one" title="Duplicate id" %}

{% bogus /%}

{% code file="models/planning_pool_item.py" from=1 to=400 expect="from odoo import api" /%}

{% code file="models/does_not_exist.py" from=1 to=3 expect="anything" /%}

{% /section %}

{% section id="one" title="Same id again" %}

{% fields %}
{% o-field name="allocation_id" kind="Many2one" comodel="planning.allocation" %}
The source row.
{% /o-field %}
{% /fields %}

{% /section %}

{% section id="three" title="Wrong and missing expect" %}

{% code file="models/planning_pool_item.py" from=1 to=3 expect="class PlanningPoolItem" /%}

{% code file="models/planning_pool_item.py" from=4 to=6 /%}

{% files /%}

{% /section %}
