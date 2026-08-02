---
walkthrough: 1
title: A section id used twice
pr: 42
commit: __COMMIT__
---

{% section id="dup" title="First" %}

{% code file="models/planning_pool_item.py" from=1 to=3 expect="from odoo import api" /%}

{% /section %}

{% section id="dup" title="Same id again" %}

{% code file="models/does_not_exist.py" from=1 to=3 expect="anything" /%}

{% /section %}
