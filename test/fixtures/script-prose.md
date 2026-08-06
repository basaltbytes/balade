---
walkthrough: 1
title: Close the </script> hole
pr: 42
commit: __COMMIT__
meta:
  module: acme_planning
---

{% section id="overview" title="Overview" icon="list-unordered" %}

The template escapes every `</script>` the prose carries, and `<!--` with it,
so a walkthrough about HTML still exports.

{% callout tone="key" %}
An unescaped `</script>` would end the baked payload early.
{% /callout %}

{% files /%}

{% /section %}
