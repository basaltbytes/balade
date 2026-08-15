/** Persistent sidebar navigation for clarification threads and their lifecycle. */

import type { QaThread, Section } from "../contract";
import { Octicon } from "./octicon";
import { useQa } from "./qa-context";
import { useStrings } from "./strings";

const QA_STATUS_DISPLAY = {
  pending: { icon: "sync", color: "text-modified animate-spin" },
  answered: { icon: "check-circle-fill", color: "text-added" },
  failed: { icon: "alert", color: "text-removed" },
} satisfies Record<QaThread["status"], { readonly icon: string; readonly color: string }>;

function latestQuestion(thread: QaThread): string {
  if (thread.status === "pending") return thread.pending.question;
  if (thread.status === "failed") return thread.failed.question;
  return thread.turns.at(-1)?.question ?? "";
}

/** Every thread remains reachable after its section drawer closes. */
export function QaSidebar({ sections }: { sections: ReadonlyMap<string, Section> }) {
  const qa = useQa();
  const strings = useStrings();
  if (!qa.available || qa.state.threads.length === 0) return null;
  const threads = qa.state.threads.slice().reverse();

  return (
    <section className="mb-5 border-b border-border pb-4">
      <div className="mb-1.5 flex items-center justify-between px-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        <span>{strings.qa.title}</span>
        <span className="tabular-nums">{threads.length}</span>
      </div>
      <div className="space-y-1">
        {threads.map((thread) => {
          const question = latestQuestion(thread);
          const display = QA_STATUS_DISPLAY[thread.status];
          return (
            <button
              key={thread.id}
              type="button"
              onClick={() => qa.openThread(thread.anchor.sectionId, thread.id)}
              aria-label={`${question} · ${strings.qa.status[thread.status]}`}
              className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-secondary/60 cursor-pointer"
            >
              <Octicon
                name={display.icon}
                size={13}
                className={`${display.color} mt-0.5 shrink-0`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] text-secondary-foreground">
                  {question}
                </span>
                <span className="mt-0.5 flex items-center justify-between gap-2 text-[10.5px] text-muted-foreground">
                  <span className="truncate">
                    {sections.get(thread.anchor.sectionId)?.title ?? thread.anchor.sectionId}
                  </span>
                  <span className="shrink-0">{strings.qa.status[thread.status]}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
