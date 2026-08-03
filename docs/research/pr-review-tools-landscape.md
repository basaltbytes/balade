# AI PR-review / explanation tools — landscape, August 2026

Fact-gathering survey of the AI PR-review, PR-summarization, and PR-explanation
tool landscape, for evaluating balade against it. Facts only — competitive
judgment happens elsewhere.

Sources checked on 2026-08-02/03, primary material only: official docs,
pricing pages, vendor changelogs/blogs, and vendor GitHub repos. Listicles were
used only to discover candidates, never as the citation for a claim. Claims
that could not be verified on a primary page are marked UNVERIFIED. Where a
vendor page contradicted pre-2026 common knowledge, the page won (several
tools renamed, repriced, pivoted, or changed hands in the last 12 months).

## TL;DR comparison

| Tool | Output → where it lives | Grounding vs diff | Review surface | OSS / self-host | BYOK | Pricing | CI/CD |
|---|---|---|---|---|---|---|---|
| CodeRabbit | Walkthrough comment (Mermaid sequence diagrams, effort score) + inline comments + summary into PR description; docstring follow-up PRs | Sandboxed real linters/SAST alongside AI prose; no validation of the prose itself | Git-host PR UI + IDE ext. + CLI | Proprietary; self-host Enterprise 500+ seats only | No (self-host tier connects own LLM) | Free / $24 / $48 per user/mo; free for public repos | Webhook app; CLI for CI |
| GitHub Copilot code review | Comment-only review + suggested changes; manual PR summary into description | None; docs explicitly disclaim hallucination risk | GitHub PR UI | Proprietary | No; model undisclosed | Copilot plans $10–$100/mo; usage in AI credits ($0.01) + Actions minutes since 2026-06-01 | Branch rulesets auto-request |
| Qodo PR-Agent (OSS) | `/describe` edits PR title/description (walkthrough); `/review`, `/improve` comments; `/update_changelog` can commit to CHANGELOG.md | None | Git-host PR UI | MIT, fully self-hostable | Yes — any model via LiteLLM | Free (your keys) | GitHub Action, GitLab webhook, Docker, CLI |
| Qodo platform (hosted) | Comments + description edits + applied fixes | Multi-agent judge filters low-confidence findings (no code-existence check) | Git-host PR UI + dashboard | SaaS; on-prem Enterprise | No | Usage-based; Pro Team $30/mo + credit packs ($0.012/credit) | Auto-runs on PR open |
| Greptile | Summary comment (diagrams, 0–5 confidence) + inline severity comments | TREX runs generated tests in sandbox, attaches evidence (beta) | Git-host PR UI + CLI | SaaS; air-gapped self-host Enterprise | Yes — OpenAI-compatible API / Bedrock | Free (1 dev) / $30/seat/mo + credits | Webhooks; CLI in any CI |
| Graphite Agent (ex-Diamond) | Summary + inline comments + suggested fixes; AI-generated PR description | None; feedback-loop stats only | Own review app, synced to GitHub | SaaS | No | Free / $20 / $40 per user/mo | Merge queue; CI action |
| Cursor Bugbot | Bug summary + inline comments + "Cursor Bugbot" CI check | None; resolution-rate claims only | Git-host PR UI (GH/GL/BB) | SaaS | No | Usage-based ~$1.00–1.50/run (subscription retired 2026-06) | Native CI check, can gate merges |
| Ellipsis | One consolidated PR review + inline comments | "Gatekeeper" model pass checks claims against code (no test execution) | GitHub PR UI | SaaS | Yes — Anthropic key, Bedrock, custom proxy | Usage-based (tokens + sandbox compute + 100% platform fee) | Webhook; optional `code_review.yaml` |
| CodeAnt AI | Inline comments + quality-gate summary + PR description | Deterministic scanners (SAST/secrets/coverage) beside unvalidated AI comments | Git-host PR UI + dashboard + IDE | SaaS; on-prem/VPC Enterprise | No | Premium $24/user/mo; free for OSS | GH Actions, GitLab CI, Jenkins, etc. |
| Baz | Agent comments, validated fix commits, AI walkthrough descriptions, merge verdicts | Strongest: sandbox lint/build gates on fixes; sandboxed app launch; AST diffing | Own review workspace + git host | SaaS; VPC "Private Mode" / full self-host | No | Pro $30/dev/mo + usage credits ($0.01) | Check results; Merger consumes CI status |
| What The Diff | PR description via shortcodes, or summary comment; weekly reports; hosted changelog | None | Git-host PR UI | SaaS | No | Token-based: free 25k tok/mo, $19/mo for 200k | None (webhooks only) |
| Swimm | (Pivoted 2026) Committed `.sw.md` docs + CI verify — legacy; now modernization services | Patented Auto-sync + Verify CI check fails on drift (legacy product) | IDE plugins + web app + GitHub App | SaaS; on-prem/air-gapped | Enterprise BYO-LLM (Azure OpenAI etc.) | Priced per line of code, contact sales | GitHub App verify on every PR (legacy) |

Collaboration (axis d) is uniform across the review bots: output is ordinary
PR comments/description edits visible to every reviewer. The exceptions are
noted per tool (IDE/CLI pre-push reviews are per-user; balade-adjacent tools
differ).

## The core crowd

### CodeRabbit

- (a) Posts a **walkthrough comment** — "a structured overview of the changes
  that appears at the top of the PR comment thread" — with toggleable
  sections: changed-files summary, **sequence diagrams (Mermaid, rendered
  inline)**, estimated review effort (1–5), related issues/PRs, linked-issue
  assessment, suggested labels/reviewers, poem
  (<https://docs.coderabbit.ai/pr-reviews/walkthroughs>). Inline line-level
  comments; the high-level summary goes **into the PR description** by default
  (`high_level_summary_in_walkthrough: true` moves it into the walkthrough
  comment). `@coderabbitai generate docstrings` commits docstrings to a new
  branch and opens a follow-up PR
  (<https://docs.coderabbit.ai/finishing-touches/docstrings>). Scheduled
  reports go out via email/Slack/Discord/Teams
  (<https://docs.coderabbit.ai/guides/reports-overview>).
- (b) Runs "50+ third-party linters and security analysis tools" in sandboxes
  (<https://docs.coderabbit.ai/tools>) — real signal, but presented alongside
  the AI review; **no documented mechanism validates the AI prose against the
  diff**.
- (c) Native PR UI of GitHub, GitLab, Azure DevOps, Bitbucket; IDE extensions
  (VS Code, Cursor, Windsurf) and a CLI that "works with Claude Code, Cursor,
  Codex, Gemini, and more" (<https://docs.coderabbit.ai/>,
  <https://docs.coderabbit.ai/faq>).
- (d) PR output shared with all reviewers; IDE/CLI reviews are per-user
  pre-push.
- (e) Proprietary. Self-hosting is Enterprise-only at **500+ seats** ("a
  container image that you run in your own environment", connect "your own
  large language model provider" — Azure OpenAI / Bedrock;
  <https://docs.coderabbit.ai/self-hosted/github>). BYOK on standard SaaS
  plans: not documented (UNVERIFIED / appears unavailable).
- (f) Free $0, Pro $24/user/mo, Pro Plus $48/user/mo (annual), Enterprise
  custom (<https://www.coderabbit.ai/pricing>). Public repos reviewed free
  forever, rate-limited (<https://docs.coderabbit.ai/faq>). CLI overage $0.25
  per reviewed file (<https://docs.coderabbit.ai/cli/overview>).
- (g) Webhook-driven git app; CLI supports headless CI via Agentic API keys.
- (h) Changelog active — latest entry 2026-07-30; CLI v0.7.1 on 2026-07-28
  (<https://docs.coderabbit.ai/changelog>).
- Post-merge: docstring PRs are committed code; reports and dashboard
  analytics persist; the walkthrough itself remains only a PR comment.

### GitHub Copilot code review + PR summaries

- (a) Review comments with click-to-apply suggested changes; "Copilot always
  leaves a 'Comment' review, not an 'Approve' or 'Request changes' review" and
  never counts toward required approvals
  (<https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/copilot-code-review>).
  PR summaries are **manual-only** ("only created when users request them
  manually", never auto-refreshed), generated into the PR description or a
  timeline comment, English only, files over 400 combined changed lines
  excluded
  (<https://docs.github.com/en/copilot/how-tos/use-copilot-for-common-tasks/create-a-pr-summary>,
  <https://docs.github.com/en/copilot/responsible-use/pull-request-summaries>).
- (b) None. GitHub's own docs: "Copilot code review has a risk of
  hallucination—it may highlight problems in reviewed code that do not
  exist"; summaries "may generate output that sounds plausible but is
  factually incorrect… or entirely fabricated"
  (<https://docs.github.com/en/copilot/responsible-use-of-github-copilot-features/responsible-use-of-github-copilot-code-review>).
- (c) Natively in the GitHub.com PR UI (Reviewers sidebar → Copilot); review
  selection in VS Code.
- (d) Normal PR content, visible to everyone; org members **without** a
  Copilot license can use it when an admin enables it.
- (e) Proprietary native feature; no self-host, no BYOK; "the model is
  selected automatically and is not disclosed"
  (<https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing>).
- (f) Plans: Free (review-selection only), Pro $10/mo, Pro+ $39/mo, Max
  $100/mo, Business $19/seat/mo, Enterprise $39/seat/mo
  (<https://docs.github.com/en/copilot/get-started/plans>). Since
  **2026-06-01** all Copilot usage bills as **AI credits (1 credit = $0.01)**
  and each code review additionally consumes **GitHub Actions minutes** on
  private repos
  (<https://github.blog/changelog/2026-04-27-github-copilot-code-review-will-start-consuming-github-actions-minutes-on-june-1-2026/>).
  Per-plan credit allowances: UNVERIFIED on the pages checked.
- (g) No Action to install — automatic review via branch rulesets
  ("Automatically request Copilot code review"), org rulesets, or personal
  setting; configurable Low/Medium effort
  (<https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/configure-automatic-review>).
- (h) Actively developed (billing changelog 2026-04-27; several review tools
  in public preview).
- Post-merge: summary persists in the PR description, comments on the merged
  PR; nothing is committed to the repo.

### Qodo PR-Agent (open source) / Qodo platform (hosted)

- Status change: PR-Agent is now "an open-source, AI-powered code review
  agent and a community-maintained legacy project of Qodo"; the repo states
  "This project is not the Qodo free tier"
  (<https://github.com/qodo-ai/pr-agent>). **Qodo Merge no longer exists as a
  separate product** — capabilities were folded into the Qodo Platform, where
  review is called "Git" (<https://www.qodo.ai/formerly-qodo-merge/>).
- (a) OSS commands: `/describe` "generate title, summary, walkthrough and
  labels" — **edits the PR title/description**; `/review` posts a findings
  comment (security, review effort, tests); `/improve` posts committable
  suggestions; `/ask` Q&A; `/update_changelog` posts a comment or, with
  `push_changelog_changes: true`, **commits directly to CHANGELOG.md**
  (<https://github.com/qodo-ai/pr-agent>,
  <https://github.com/qodo-ai/pr-agent/blob/main/docs/docs/tools/update_changelog.md>).
  Hosted: same plus "let Qodo apply the fix directly"
  (<https://docs.qodo.ai/code-review>).
- (b) OSS: no programmatic validation claimed. Hosted: parallel specialized
  agents plus "a judge agent [that] merges their findings, removes
  duplicates, and filters out anything low-confidence" — confidence
  filtering, not a check that quoted code exists
  (<https://docs.qodo.ai/code-review>).
- (c) Git-host PR UI; hosted adds a dashboard.
- (d) Shared PR comments/description edits; commands invocable by any
  collaborator.
- (e) PR-Agent: **MIT license, "Copyright (c) 2026 The PR Agent"**
  (<https://github.com/qodo-ai/pr-agent/blob/main/LICENSE>) — note this
  contradicts the historically reported Apache-2.0; the relicense accompanied
  the community donation. Self-hostable with your own keys: "OpenAI GPT,
  Anthropic Claude, Google Gemini, DeepSeek, Mistral, and any other model
  reachable through LiteLLM" incl. Azure, Bedrock, Vertex, Ollama. Hosted:
  proprietary SaaS; Enterprise single-tenant or on-prem
  (<https://www.qodo.ai/pricing/>).
- (f) Hosted is now **usage-based, workspace-level** ("Billing is usage-based
  (not seat-based)"): Pro Team $30/mo (up to 30 users) + pooled credit packs
  at $0.012/credit (~18/~36/~144 reviews per month per pack); Enterprise
  custom; free for qualified OSS (<https://www.qodo.ai/pricing/>,
  <https://docs.qodo.ai/pricing-and-usage>). The old 75-reviews/org/month
  free tier page now 404s — treat as discontinued (UNVERIFIED as current).
- (g) GitHub Action, GitLab webhook, Bitbucket app, Azure DevOps, Gitea,
  Docker, local CLI.
- (h) 12,342 stars; last push 2026-08-01; releases v0.41.1 (2026-08-01),
  v0.41.0 (2026-07-26), v0.40.0 (2026-07-25)
  (<https://github.com/qodo-ai/pr-agent/releases>).
- Post-merge: `/describe` output persists in the PR title/description;
  opt-in CHANGELOG.md commit is the only committed artifact among its
  defaults.

### Greptile

- (a) Per review: a top-level summary comment (plain-language explanation,
  **0–5 merge-readiness confidence score**, file-by-file breakdown,
  **auto-generated diagrams**) plus inline comments with P0/P1/P2 severity
  badges and suggested fixes
  (<https://www.greptile.com/docs/code-review/first-pr-review>). Nothing
  committed; SaaS dashboard for config/analytics. Codebase-context claim: a
  graph of "what every function, variable, class, file, and directory does";
  "Repo Clusters" (2026-06-02) add related repos as read-only context
  (<https://www.greptile.com/docs/code-review/key-features>,
  <https://www.greptile.com/changelog>).
- (b) **TREX** (public beta 2026-06-15) "writes and runs targeted tests in a
  sandbox," attaching evidence — logs, screenshots, traces, videos — to
  comments (<https://www.greptile.com/changelog>). Standard reviews rely on
  the confidence score and comment-type filters — model judgments, not
  executed checks.
- (c) Git-host PR UI (follow-ups via `@greptileai`); CLI runs a full review
  from the terminal (2026-06-04).
- (e) Closed SaaS. Enterprise self-host on "any compute node… with
  docker-compose", including fully **air-gapped**; BYO-LLM: "Any
  OpenAI-compatible API," custom LLMs, AWS Bedrock
  (<https://www.greptile.com/docs/security/selfhost>,
  <https://www.greptile.com/enterprise>).
- (f) Starter free (1 active developer, 50 credits/mo, since 2026-06-29); Pro
  $30/seat/mo (50 credits/seat, $1/extra credit; 1 credit = standard review,
  3 = TREX review); Enterprise custom; free for qualifying MIT/Apache OSS
  (<https://www.greptile.com/pricing>).
- (g) Webhook-driven; CLI enables arbitrary CI.
- (h) Very active changelog: 2026-06-04/15/22/29 entries.
- Post-merge: comments/diagrams persist on the merged PR page; analytics and
  learned team preferences in the dashboard; nothing in the repo.

### Graphite (Agent, formerly Diamond)

- Status: graphite.dev now redirects to graphite.com; **"Diamond" was retired
  2025-10-07** — merged into "Graphite Agent"
  (<https://graphite.com/blog/introducing-graphite-agent-and-pricing>).
  **Graphite signed a definitive agreement to join Cursor, announced
  2025-12-19**, saying it will keep operating its stacked-PR platform
  (<https://graphite.com/blog/graphite-joins-cursor>).
- (a) Summary comments, inline comments, suggested fixes; a "Generate" button
  has the Agent write the **PR title/description from the diff** (persists as
  the PR body) (<https://graphite.com/docs/diamond>,
  <https://graphite.com/guides/ai-generated-pr-descriptions>).
- (b) No programmatic validation; vendor cites feedback stats ("less than 5%
  negative comment rate") and plain-language custom rules
  (<https://graphite.com/features/ai-reviews>).
- (c) **Own full review app**: "Anything you can do through the GitHub UI,
  you can do in Graphite" — approvals sync back to GitHub
  (<https://graphite.com/docs/review-pull-requests>,
  <https://graphite.com/guides/managing-pull-request-approvals-and-reviews>).
- (e) Closed SaaS; no self-host of the service (Enterprise gets GHES); no
  BYOK found (UNVERIFIED/none).
- (f) Hobby free; Starter $20/user/mo; Team $40/user/mo (unlimited AI
  reviews, merge queue); Enterprise custom; annual = 20% off
  (<https://graphite.com/pricing>).
- (g) Merge queue (Team+); public `graphite-ci-action`
  (<https://github.com/withgraphite>).
- (h) CLI changelog v1.8.5 2026-04-20; product blog cadence thinner
  post-acquisition (<https://graphite.com/docs/cli-changelog>).
- Post-merge: the AI-written PR description is the durable artifact; team
  insights in the dashboard; nothing committed.

### Cursor Bugbot

- (a) Top-level bug summary comment + inline comments with fix suggestions
  and "Fix in Cursor" / "Fix in Web" links; publishes a **CI check named
  "Cursor Bugbot"**. GitHub (incl. GHES), GitLab (incl. self-hosted),
  Bitbucket (incl. Data Center) (<https://cursor.com/docs/bugbot>).
- (b) No programmatic validation; vendor claims "70%+ of flags get resolved
  before merge" and configurable effort levels ("high effort finds 35% more
  bugs while resolution rate stays constant at 80%")
  (<https://cursor.com/bugbot>,
  <https://cursor.com/blog/may-2026-bugbot-changes>).
- (c) Host PR UI; Cursor dashboard for settings/analytics.
- (e) Closed SaaS; no self-host of Bugbot itself; no BYOK found.
- (f) Launch subscription of $40/user/mo **retired**: usage-based billing
  effective at first renewal after **2026-06-08**, "the average Bugbot run
  costs $1.00–$1.50" (<https://cursor.com/blog/may-2026-bugbot-changes>).
  Whether the free Hobby plan gets any runs: UNVERIFIED on vendor pages.
- (g) First-class CI check with success/neutral/failure conclusions — can
  gate merges via required checks; Bitbucket build key `cursor-bugbot`.
- (h) Very active; Cursor changelog latest 2026-07-29
  (<https://cursor.com/changelog>).
- Post-merge: comments and check results persist on the merged PR; nothing
  committed.

### Ellipsis

- Status: pivoted — homepage is now "Cloud platform for coding agents";
  blog gap from 2025-04-25 until "Introducing the Ellipsis Agent Cloud"
  (2026-07-28). Code review survives as one product on the platform
  (<https://www.ellipsis.dev/>, <https://www.ellipsis.dev/blog>).
- (a) Inline comments consolidated into "one pull request review" per run;
  posts "a one-line clean summary rather than invented nitpicks" when clean;
  incremental — "a review covers the commits since the last review"
  (<https://www.ellipsis.dev/docs/code-review>).
- (b) A **"gatekeeper" verification stage** "checks each claim against the
  code and drops what does not hold"; the reviewer "reads the surrounding
  code, not the diff alone." A second model pass over claims — not test
  execution (<https://www.ellipsis.dev/docs/code-review>).
- (c) GitHub PR UI; app.ellipsis.dev is logs/budgets/config only.
- (e) Closed SaaS in isolated sandboxes; no self-host. **BYOK: yes,
  explicitly** — Anthropic API key ("tokens bill your Anthropic account"),
  AWS Bedrock credentials, or a custom LLM proxy/gateway; default model
  listed as "Claude Opus 5" (<https://www.ellipsis.dev/docs/models>).
- (f) Usage-based per session: provider-rate tokens (**free if using your own
  key**), sandbox CPU $0.1419/core-hour, memory $0.0242/GiB-hour, platform
  fee 100% of token+compute (min $0.10/session); $100 org / $10 personal
  sign-up credit; layered hard spend caps
  (<https://www.ellipsis.dev/docs/billing>).
- (g) Webhook-driven ("no YAML required"); optional `code_review.yaml` scopes
  PRs and caps spend. GitLab support in the current platform: UNVERIFIED.
- (h) Blog 2026-07-28 after a 15-month silence — a stability signal worth
  noting.
- Post-merge: nothing committed; session logs in the dashboard; legacy
  "Codebase Reports" presence in the current platform UNVERIFIED.

### CodeAnt AI (picked over Sourcery)

- Liveness comparison: Sourcery's newest changelog entry is 2025-12-23 and
  newest blog post 2025-10-23 — no public 2026 shipping evidence
  (<https://www.sourcery.ai/changelog>, <https://www.sourcery.ai/blog>).
  CodeAnt's blog runs through 2026-07-08 with an active docs site
  (<https://codeant.ai/blogs>, <https://docs.codeant.ai/llms.txt>) — CodeAnt
  researched in depth.
- (a) Inline comments (severity Critical→Low, ready-to-apply "Commit
  suggestion" button, a "Prompt for AI Agent" copy block) plus a summary
  comment with a **Quality Gate pass/fail** (secrets, duplicate code, SAST,
  coverage) (<https://docs.codeant.ai/pull_request/features/code_review.md>);
  auto-generated PR description
  (<https://docs.codeant.ai/pull_request/description.md>). Persistent SaaS
  Control Center / Scan Center dashboards.
- (b) Hybrid: the quality gate is fed by deterministic scanners (org repos
  include Checkov/Prowler forks — <https://github.com/CodeAnt-AI>); the AI
  comments themselves have **no documented programmatic validation**;
  "Learnings" trains via dismissals (feedback, not verification).
- (c) Native PR UI of GitHub, GitLab (incl. self-hosted), Bitbucket (incl.
  DC), Azure DevOps; IDE extensions, CLI, MCP server.
- (e) Closed SaaS; Enterprise on-prem/VPC/air-gapped. BYOK: no mention
  anywhere (UNVERIFIED / apparently not offered).
- (f) Premium **$24/user/mo**, Enterprise contact sales (vendor blog,
  2026-08-03: <https://codeant.ai/blogs/best-ai-code-review-tools>); 14-day
  trial, "100% OFF FOR OPEN SOURCE" (<https://codeant.ai/pricing>).
- (g) GitHub Actions, GitLab CI/CD, Bitbucket Pipelines, Azure Pipelines,
  Jenkins; configurable PR quality gates
  (<https://docs.codeant.ai/llms.txt>).
- (h) Blog through 2026-07-08; GitHub Marketplace listing shows 7,028
  installs (<https://github.com/marketplace/codeant-ai>).
- Post-merge: dashboards (Scan Center, Dev Metrics) persist; PR comments are
  ordinary ephemeral conversation.

### Baz (picked over cubic; both alive)

- Liveness: effectively a tie — cubic has changelog entries 2026-07-24/27/28/29
  (<https://docs.cubic.dev/changelog/changelog>) and pricing (free Starter 20
  PR reviews/mo, Team $30/dev/mo, Pro $79/dev/mo annual, free OSS —
  <https://www.cubic.dev/pricing-plans>); Baz has three changelog entries on
  2026-07-29 alone (<https://baz.ai/changelog>) and the broader platform, so
  it got the deep dive. Note baz.co now 301-redirects to **baz.ai** (domain
  change, not a pivot; still "Baz Technologies, Inc.", © 2026).
- (a) Agent findings as PR comments (Guidelines Enforcer, Logic Analyzer, API
  Contract Checker, Type Validator, security agents), **suggested-fix commits
  against the PR** (Fixer), merge verdicts as labels/comments (Merger), and
  **AI Walkthrough descriptions/change summaries**
  (<https://baz.ai/docs/agents/baz-agents>). Output lives in the git-host PR
  and in Baz's own workspace + dashboards.
- (b) Strongest grounding found in the survey: Fixer "runs strict format,
  lint and build validations, and only commits changes when validation
  succeeds" in an ephemeral sandbox; Spec Reviewer "can now launch the
  application from the Change branch inside an isolated sandbox"
  (2026-07-29); Merger uses "deterministic pass criteria" over diff, CI
  status, and findings; diffs computed structurally via AST diffing
  (difftastic + tree-sitter) (<https://baz.ai/changelog>,
  <https://baz.ai/docs/agents/baz-agents>,
  <https://baz.ai/resources/blog/why-your-code-gen-ai-doesnt-understand-diffs>).
- (c) **Own review app confirmed**: a unified workspace to "understand the
  change, inspect implementation details, review comments, validate merge
  readiness, and approve the PR without leaving the page"; review works "both
  within GitHub or optionally in a curated developer experience on the Baz
  platform" (<https://baz.ai/docs/capabilities/pull-requests>). Whether
  Baz-UI comments sync back to GitHub threads: UNVERIFIED.
- (e) Closed SaaS core; OSS satellites (baz-cli 47 stars, awesome-reviewers
  141 stars — <https://github.com/baz-scm>). Deployment shapes: Baz Cloud,
  Private Mode (pod in your VPC), full self-hosted (Enterprise)
  (<https://baz.ai/docs/account/private-mode>). BYOK for model keys: no
  mention (UNVERIFIED / apparently not offered).
- (f) Pro **$30 per active developer/mo** + usage-based "Engineering Work
  Credits" at $0.01/credit (Fixer sessions $1.00–$4.30; vendor guidance:
  budget $20–50/dev/mo in credits); Enterprise custom; no free tier listed
  (<https://baz.ai/pricing>).
- (g) Findings surface as comments and **check results**; GitHub, GitLab,
  Azure DevOps (no Bitbucket) (<https://baz.ai/docs>).
- (h) Changelog through 2026-07-29; org pushed 2026-08-01.
- Post-merge: Engineering Impact dashboard, Merger stats, session history —
  persistent SaaS artifacts.

## PR-explanation / walkthrough-adjacent

### What The Diff

- (a) Two modes: shortcodes in the PR description that WTD replaces in the
  body (`wtd:summary`, novelty `wtd:joke`/`wtd:poem`), or a summary posted as
  a PR comment (on create/update or only when a "WTD" label is added). Also
  Slack/webhook/email notifications with translated summaries, **weekly
  progress reports**, and hosted public changelogs with a JSON API
  (<https://whatthediff.ai/getting-started>, <https://whatthediff.ai/>). A
  describer, not a reviewer — no line-by-line review comments.
- (b) None — reads the diff via the GitHub/GitLab API and generates prose;
  no validation documented.
- (c) Entirely in the git-host PR UI; the dashboard is settings + hosted
  changelogs.
- (e) Closed SaaS by Beyond Code GmbH; **no BYOK**, no self-host
  (<https://whatthediff.ai/pricing>).
- (f) **Token-based**: Free 25,000 tokens/mo (~10 PRs); Pro $19/mo for
  200,000 tokens (~40 PRs); "average pull requests are ~2,300 tokens"; no
  rollover; 50,000-token default cap per PR
  (<https://whatthediff.ai/pricing>).
- (g) None — purely webhook-driven.
- (h) **Weak — likely maintenance mode**: no vendor blog or changelog; the
  footer still links "Copilot X for GitLab" (2023-era branding); Beyond
  Code's own site no longer lists WTD among its products
  (<https://beyondco.de/>); site, app, and Marketplace listing (5,696
  installs) remain live (<https://github.com/marketplace/what-the-diff>).
- Post-merge: the improved PR description persists in git-host history; the
  hosted changelog and weekly reports are consumed after merge.

### Swimm

- **Pivoted.** Rebranded 2026-03-24 as "Swimm 2.0: the understanding platform
  for AI modernization" — agentic legacy modernization (COBOL/JCL/PL/I,
  Java/.NET migrations), an "Agentic Context Layer," MCP server, delivered as
  SaaS + services
  (<https://swimm.io/blog/swimm-2-0-the-understanding-platform-for-ai-modernization>,
  <https://swimm.io/>). The company describes moving "from Software as a
  Service to Service as a Service"
  (<https://swimm.io/blog/weve-stopped-asking-customers-to-bet-on-the-right-tool>,
  2026-05-06).
- Legacy product (still documented, no sunset notice): code-coupled docs as
  Markdown files **committed under `.swm/[name].sw.md`**
  (<https://docs.swimm.io/getting-started-guide/creating-a-doc/>). The
  patented Auto-sync algorithm (line markers, token references, change size,
  file history) decides whether a snippet auto-syncs; if a change is too
  impactful the **Swimm Verify CI check fails** and flags the doc outdated
  (<https://swimm.io/blog/how-does-swimm-s-auto-sync-feature-work>,
  <https://docs.swimm.io/continuous-integration/>). The GitHub App runs
  verify on every PR, comments on the PR, and can auto-commit Auto-sync fixes
  (<https://docs.swimm.io/continuous-integration/github-app/>).
- PR angle: the GitHub App's **PR-to-doc** flow drafts a doc from a PR's
  changes — knowledge capture *after* the fact, not a review aid consumed
  during review. **Nothing Swimm ships today produces PR-level walkthroughs
  or review aids.**
- Whether new customers can still buy the continuous-docs product standalone:
  UNVERIFIED — homepage and pricing no longer mention it. Pricing is "based
  on the number of lines of code you want to understand", contact sales
  (<https://swimm.io/pricing>). On-prem/air-gapped deployments and
  customer-managed LLMs (Azure OpenAI, OpenAI Enterprise) supported at
  enterprise level.
- Maintenance: blog active through 2026-07-14 (pivot-focused); VS Code
  extension retitled "Application Understanding Platform", updated
  2026-05-25; `swimm-verify-action` (3 stars) near-dormant. Signal:
  continuous-docs tooling is maintained-but-frozen.

## Cross-cutting facts

### BYOK / own-subscription support

Confirmed BYOK (your model account gets billed, or your key is used):

- **Qodo PR-Agent (OSS)** — any model via LiteLLM, fully self-hosted, MIT.
- **Ellipsis** — Anthropic API key, AWS Bedrock, or custom proxy; token cost
  drops out of Ellipsis billing when using your own key.
- **Greptile** — Enterprise self-host with "any OpenAI-compatible API" or
  Bedrock.
- **CodeRabbit** — self-hosted (Enterprise, 500+ seats) connects your own
  LLM provider; not on SaaS plans.
- **Swimm** — enterprise deployments integrate customer-managed LLM
  instances.

No BYOK found (vendor-billed only): GitHub Copilot (model undisclosed),
Qodo hosted platform, Graphite, Cursor Bugbot, CodeAnt AI, Baz, What The
Diff, cubic. None of the surveyed tools supports a consumer Claude
Pro/Max or ChatGPT subscription as the billing vehicle; BYOK where present
means API keys or cloud-provider credentials.

### Post-merge persistence

- **Nothing committed to the repo** by any core-crowd reviewer in its default
  flow. The exceptions that touch git history at all: CodeRabbit's docstring
  follow-up PRs, Qodo PR-Agent's opt-in CHANGELOG.md commit, Baz's
  validated Fixer commits — all code changes, none of them review narrative.
- Artifacts that persist as PR metadata: AI-written PR descriptions (Qodo
  `/describe`, Graphite, What The Diff shortcode mode, CodeRabbit's summary,
  Copilot's manual summary) survive in the PR body; review comments survive
  on the merged PR page but are conversation, not a navigable artifact.
- SaaS-side persistence: dashboards/analytics (Greptile, CodeAnt, Baz,
  Qodo hosted, Cursor), scheduled reports (CodeRabbit, What The Diff).
- The only surveyed product whose primary artifact is committed,
  version-controlled, and CI-verified is Swimm's legacy continuous-docs
  product — repo-scoped documentation, not PR review, and de-emphasized
  since the 2026 pivot.

### Committed-walkthrough uniqueness check

Question: does any tool produce a committed, version-controlled,
CI-validated narrated walkthrough scoped to reviewing a specific PR?

Candidates checked:

- **CodeSee** — dead as a product. codesee.io and app.codesee.io return 404;
  GitKraken announced acquiring CodeSee 2024-05-14
  (<https://www.gitkraken.com/press/gitkraken-acquires-codesee-launches-devex-platform>);
  its "Review Maps" were auto-generated SaaS visualizations, never committed
  narrative. GitHub org stale/archived (<https://github.com/Codesee-io>).
- **Reviewable** — alive (enterprise changelog releases 2026-05-06 and
  2026-05-29 — <https://github.com/Reviewable/Reviewable/blob/master/enterprise/changelog.md>).
  A review UI over GitHub PRs; review state lives in Reviewable's datastore,
  nothing committed, no AI narration (<https://reviewable.io/>).
- **CodeApprove** — resolves (latest Wayback snapshot 2026-04-18) but no
  2025–2026 changelog found; liveness UNVERIFIED beyond weak signals. A
  Critique-style review overlay; nothing committed
  (<https://codeapprove.com/>).
- **VS Code CodeTour** — closest structural cousin. Tours are JSON files
  committed in-repo (`.tours`); repo pushed 2026-05-05, 4,553 stars, but the
  last release is v0.0.59 from 2023-03-24
  (<https://github.com/microsoft/codetour>). CI validation is third-party
  only: the CodeTour Watch action detects "tour drift" on PRs and has a
  strict mode that fails the build (<https://github.com/pozil/codetour-watch>,
  19 stars) — path/line drift detection, not content verification. Tours are
  editor-bound, repo-scoped onboarding; no tool adapting CodeTour to
  PR-scoped review was found.
- **Plannotator** — nearest live neighbor on the "narrated tour for review"
  axis: open-source local diff viewer whose "Code Tours" feature generates "a
  narrated walkthrough with checkpoints" scoped to the current diff/PR/stack
  (<https://plannotator.ai/code-review/>). But tours are saved to a local
  data directory — not committed — and there is no CI validation; it does
  not post to GitHub/GitLab
  (<https://docs.plannotator.ai/open-source/workflows/agent-reviews.md>).
- **"Storytime" / narrated-PR tools** — no such tool found. Closest hits:
  CodeRabbit's walkthrough comment (ephemeral), Qodo `/describe` walkthrough
  (PR description), and GitHub Next's "Copilot for Pull Requests"
  `copilot:walkthrough` marker — that experiment **concluded**, technical
  preview ended 2023-12-15
  (<https://githubnext.com/projects/copilot-for-pull-requests/>).
- Also surfaced: zcaceres/code-tour (dormant hobby project, committed
  onboarding tours, not PR-scoped); the essay "Code Tours as Code"
  (<https://dundalek.com/entropic/code-tours/>) proposes committed +
  CI-checked tours but is a proposal, not a product; Gitpod/Ona
  "onboarding" is dev environments, not walkthrough artifacts.

**Result: no tool found that combines all three properties — (1) a
committed, version-controlled walkthrough file, (2) CI validation against
the code, (3) a narrative scoped to reviewing a specific PR.** Each
candidate holds at most two: CodeTour is committed + third-party
CI-drift-checked but repo-scoped onboarding; Plannotator is PR-scoped +
narrated but local-only with no CI; CodeRabbit/Qodo/Copilot narrate
PR-scoped but as ephemeral comments; Swimm (legacy) is committed +
CI-verified but produces after-the-fact documentation, not a review
walkthrough — and that product line is de-emphasized since the pivot.

Search queries run for the sweep (each with its one-line outcome):

1. `CodeSee GitKraken acquisition shut down app.codesee.io 2024` — GitKraken
   press release; secondary Feb 2024 shutdown claim (primary evidence: 404).
2. `CodeApprove code review GitHub tool Sam Stern pricing 2025` — Indie
   Hackers thread; pricing page renders nothing to fetchers (SPA).
3. `"guided code review" tool committed walkthrough repository CI validated`
   — only AI PR-comment bots; first Plannotator sighting; nothing committed.
4. `"narrated pull request" OR "PR walkthrough" tool committed file` —
   CodeRabbit walkthrough comments, GitHub Next experiment; nothing
   committed.
5. `"storytime" narrated pull request code review walkthrough tool GitHub` —
   no "Storytime" tool exists.
6. `CodeTour adapt "pull request" review tours PR diff walkthrough extension`
   — CodeTour Watch action; no PR-review adaptation of CodeTour.
7. `reviewable.io changelog 2026 update` — confirmed Reviewable liveness.
8. `"code walkthrough" file committed repository "onboarding tour" tool
   docs-as-code CI` — "Code Tours as Code" essay; no product.
9. `CodeApprove github code review app 2026 shutdown OR active OR changelog`
   — nothing about CodeApprove at all.
10. `Gitpod onboarding tour codebase walkthrough committed repo tool` —
    Gitpod onboarding = dev environments; surfaced zcaceres/code-tour.
11. `AI generated "walkthrough" committed markdown file repository "pull
    request" review CI verify tool` — CI bots posting markdown *comments*;
    nothing writes a committed walkthrough file.
12. `"reviewer guide" OR "review guide" committed file repo pull request
    generate tool` — human process documentation only; no tool generating
    committed reviewer guides.
