---
"balade": minor
---

`balade generate` resolves the overwrite decision before the paid model turn instead of failing after it. A walkthrough stamped at an older head is refreshed without a prompt or flag — regenerating after the pull request moved is the intended path — and a stale file with a different title slug is removed when the new one is written, so a re-rolled title no longer leaves a stale duplicate. A walkthrough stamped at the current head asks for confirmation on a TTY; non-interactive runs stop immediately, where `--force` skips the question. If a replaced file had uncommitted changes, a copy is kept beside it as `<file>.superseded`. The post-payment collision error, its `-recovered-` draft files, and the advice to re-run a paid turn are gone; the generated draft is always checked and repaired before the session ends.
