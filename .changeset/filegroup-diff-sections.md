---
"balade": minor
---

The closing `{% files %}` block now accepts `{% filegroup label="Tests" only="**/*.test.ts" /%}` children, and the app renders the full-PR diff browser as collapsible thematic sections. A group takes a required `label`, an optional `only` glob and an optional `status` list of A, M, D and R; groups claim files in authored order, each taking the changed files its filter matches among those no earlier group claimed, and a group with no filter takes the rest. Files that no group claims still render after the groups, so grouping partitions the diff instead of filtering it and cannot hide a changed file. The authoring guidance teaches the syntax and the partition rule, and tells the agent to group the closing block once a pull request touches more than ten files, with labels drawn from the change itself.
