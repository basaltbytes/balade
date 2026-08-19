---
walkthrough: 1
title: Grouped file browser
pr: 42
commit: __COMMIT__
meta:
  module: acme_planning
  lang: en
---

{% group label="Files" %}

{% section id="overview" title="Grouped by theme" icon="file-diff" %}

{% files why={"docs/old.md": "superseded by the pool item", "i18n/fr.po": "one new label"} %}
{% filegroup label="Cross-cutting" only="static/**" /%}
{% filegroup label="Models" only="models/**" /%}
{% filegroup label="Cross-cutting" only="i18n/**" /%}
{% filegroup label="Deleted" status="D" /%}
{% filegroup label="Cross-cutting" only="**/*.py" /%}
{% filegroup label="Cross-cutting" only="{views/**,controllers/**}" /%}
{% /files %}

{% /section %}

{% section id="closing" title="Files changed" icon="file-diff" %}

{% files %}
{% filegroup label="New files" status="A" /%}
{% filegroup label="Everything else" /%}
{% /files %}

{% /section %}

{% /group %}
