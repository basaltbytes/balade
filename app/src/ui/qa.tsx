/** Selection affordance, section indicator, and clarification thread panel. */

import { useEffect, useState, type FormEvent } from "react";
import type { QaAnchor, QaThread } from "../contract";
import { runAppEffect } from "../data/runtime";
import { ensureLangs, withHighlightFallback } from "../highlight/shiki";
import { BlockView } from "../widgets";
import { Octicon } from "./octicon";
import { useQa } from "./qa-context";
import { useStrings } from "./strings";

interface SelectionTarget {
  readonly anchor: QaAnchor;
  readonly left: number;
  readonly top: number;
}

export function SelectionAsk() {
  const qa = useQa();
  const strings = useStrings();
  const [target, setTarget] = useState<SelectionTarget | null>(null);

  useEffect(() => {
    if (!qa.available) return;
    const capture = (): void => {
      const selection = window.getSelection();
      if (selection === null || selection.isCollapsed) {
        setTarget(null);
        return;
      }
      const anchorNode = selection.anchorNode;
      const focusNode = selection.focusNode;
      if (anchorNode === null || focusNode === null) {
        setTarget(null);
        return;
      }
      const anchorElement = anchorNode instanceof Element ? anchorNode : anchorNode.parentElement;
      const focusElement = focusNode instanceof Element ? focusNode : focusNode.parentElement;
      const section = anchorElement?.closest<HTMLElement>("section[id]");
      if (
        section === undefined ||
        section === null ||
        focusElement === null ||
        !section.contains(focusElement) ||
        section.closest("[data-qa-panel]") !== null
      ) {
        setTarget(null);
        return;
      }
      const excerpt = selection.toString().replace(/\s+/gu, " ").trim().slice(0, 2_000);
      if (excerpt === "") {
        setTarget(null);
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      setTarget({
        anchor: { sectionId: section.id, excerpt },
        left: Math.min(rect.right, window.innerWidth - 120),
        top: Math.min(rect.bottom + 8, window.innerHeight - 44),
      });
    };
    document.addEventListener("mouseup", capture);
    return () => document.removeEventListener("mouseup", capture);
  }, [qa.available]);

  if (target === null) return null;
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        qa.openComposer(target.anchor);
        setTarget(null);
        window.getSelection()?.removeAllRanges();
      }}
      style={{ left: target.left, top: target.top }}
      className="fixed z-40 -translate-x-full rounded-md border border-primary bg-background px-2.5 py-1.5 text-[12px] font-medium text-foreground shadow-lg hover:bg-muted cursor-pointer"
    >
      <span className="inline-flex items-center gap-1.5">
        <Octicon name="question" size={14} />
        {strings.qa.askAgent}
      </span>
    </button>
  );
}

export function QaIndicator({ sectionId }: { sectionId: string }) {
  const qa = useQa();
  const strings = useStrings();
  const threads = qa.threadsFor(sectionId);
  if (!qa.available || threads.length === 0) return null;
  const exchanges = threads.reduce(
    (count, thread) => count + thread.turns.length + (thread.status === "answered" ? 0 : 1),
    0,
  );
  const latest = threads.at(-1);
  const preview = latestQuestion(latest);
  return (
    <span className="group relative">
      <button
        type="button"
        onClick={() => qa.openSection(sectionId)}
        aria-label={strings.qa.exchanges(exchanges)}
        className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-secondary-foreground hover:border-primary hover:text-foreground cursor-pointer"
      >
        <Octicon name="question" size={12} />
        {exchanges}
      </button>
      <span className="pointer-events-none absolute right-0 top-full z-30 mt-2 hidden w-64 rounded-md border border-border bg-background p-2.5 text-left text-[11.5px] font-normal text-muted-foreground shadow-lg group-hover:block">
        {preview}
      </span>
    </span>
  );
}

function latestQuestion(thread: QaThread | undefined): string {
  if (thread === undefined) return "";
  if (thread.status === "pending") return thread.pending.question;
  if (thread.status === "failed") return thread.failed.question;
  return thread.turns.at(-1)?.question ?? "";
}

export function QaPanel() {
  const qa = useQa();
  const strings = useStrings();
  const panel = qa.panel;
  useAnswerLanguages(qa.state.threads);
  if (panel._tag === "Closed") return null;

  const sectionId = panel._tag === "Composer" ? panel.anchor.sectionId : panel.sectionId;
  const activeThreadId = panel._tag === "Thread" ? panel.threadId : null;
  const anchoredThreads = qa.threadsFor(sectionId);
  const threads =
    activeThreadId === null
      ? anchoredThreads
      : [...anchoredThreads].sort(
          (left, right) => Number(right.id === activeThreadId) - Number(left.id === activeThreadId),
        );

  return (
    <div className="fixed inset-0 z-50" data-qa-panel>
      <button
        type="button"
        aria-label={strings.qa.close}
        onClick={qa.close}
        className="absolute inset-0 bg-black/35 cursor-default"
      />
      <aside className="absolute right-0 top-0 h-full w-full max-w-[620px] overflow-y-auto border-l border-border bg-background shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center border-b border-border bg-background px-5 py-4">
          <div>
            <h2 className="text-[17px] font-semibold">{strings.qa.title}</h2>
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{sectionId}</p>
          </div>
          <button
            type="button"
            onClick={qa.close}
            aria-label={strings.qa.close}
            className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
          >
            <Octicon name="x" size={18} />
          </button>
        </header>

        <div className="space-y-5 p-5">
          {qa.failed && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12.5px] text-destructive">
              {strings.qa.unavailable}
            </p>
          )}
          {panel._tag === "Composer" && <QuestionForm anchor={panel.anchor} />}
          {threads.map((thread) => (
            <Thread key={thread.id} thread={thread} active={thread.id === activeThreadId} />
          ))}
        </div>
      </aside>
    </div>
  );
}

function QuestionForm({ anchor }: { anchor: QaAnchor }) {
  const qa = useQa();
  const strings = useStrings();
  const [question, setQuestion] = useState("");
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const value = question.trim();
    if (value === "") return;
    qa.ask({ kind: "new", anchor, question: value });
  };
  return (
    <form onSubmit={submit} className="rounded-lg border border-primary/50 bg-muted/30 p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {strings.qa.selectedPassage}
      </p>
      <blockquote className="mt-2 border-l-2 border-primary pl-3 text-[13px] text-secondary-foreground">
        {anchor.excerpt}
      </blockquote>
      <label className="mt-4 block text-[12px] font-medium" htmlFor="qa-question">
        {strings.qa.questionLabel}
      </label>
      <textarea
        id="qa-question"
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        placeholder={strings.qa.questionPlaceholder}
        rows={3}
        autoFocus
        className="mt-1.5 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-[13px] outline-none focus:border-primary"
      />
      <div className="mt-3 flex justify-end">
        <SubmitButton disabled={question.trim() === ""} />
      </div>
    </form>
  );
}

function Thread({ thread, active }: { thread: QaThread; active: boolean }) {
  const strings = useStrings();
  return (
    <article
      data-qa-thread={thread.id}
      className={`rounded-lg border p-4 ${active ? "border-primary/60" : "border-border"}`}
    >
      <blockquote className="mb-4 border-l-2 border-border pl-3 text-[12px] text-muted-foreground">
        {thread.anchor.excerpt}
      </blockquote>
      <div className="space-y-5">
        {thread.turns.map((turn) => (
          <div key={turn.id}>
            <p className="rounded-md bg-muted px-3 py-2 text-[13px] font-medium">{turn.question}</p>
            <div className="mt-3 text-[13px]">
              {turn.answer.map((block, index) => (
                <BlockView key={index} block={block} />
              ))}
            </div>
          </div>
        ))}
        {thread.status === "pending" && (
          <div>
            <p className="rounded-md bg-muted px-3 py-2 text-[13px] font-medium">
              {thread.pending.question}
            </p>
            <p className="mt-2 text-[12px] text-muted-foreground">{strings.qa.pending}</p>
          </div>
        )}
        {thread.status === "failed" && (
          <div>
            <p className="rounded-md bg-muted px-3 py-2 text-[13px] font-medium">
              {thread.failed.question}
            </p>
            <p className="mt-2 text-[12px] text-destructive">{strings.qa.failed}</p>
          </div>
        )}
      </div>
      {thread.status !== "pending" && <FollowUp thread={thread} />}
    </article>
  );
}

function FollowUp({ thread }: { thread: Exclude<QaThread, { status: "pending" }> }) {
  const qa = useQa();
  const strings = useStrings();
  const [question, setQuestion] = useState("");
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const value = question.trim();
    if (value === "") return;
    qa.ask({ kind: "follow-up", threadId: thread.id, question: value });
  };
  return (
    <form onSubmit={submit} className="mt-5 border-t border-border pt-4">
      <label className="text-[12px] font-medium" htmlFor={`qa-follow-up-${thread.id}`}>
        {strings.qa.followUp}
      </label>
      <textarea
        id={`qa-follow-up-${thread.id}`}
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        placeholder={strings.qa.followUpPlaceholder}
        rows={2}
        className="mt-1.5 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-[13px] outline-none focus:border-primary"
      />
      <div className="mt-2 flex justify-end">
        <SubmitButton disabled={question.trim() === ""} />
      </div>
    </form>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const qa = useQa();
  const strings = useStrings();
  return (
    <button
      type="submit"
      disabled={disabled || qa.submitting}
      className="rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 cursor-pointer disabled:cursor-default"
    >
      {qa.submitting ? strings.qa.submitting : strings.qa.submit}
    </button>
  );
}

function useAnswerLanguages(threads: readonly QaThread[]): void {
  useEffect(() => {
    const languages = new Set<string>();
    for (const thread of threads) {
      for (const turn of thread.turns) {
        for (const block of turn.answer) if (block.b === "code") languages.add(block.lang);
      }
    }
    if (languages.size === 0) return;
    return runAppEffect(
      ensureLangs([...languages]).pipe(withHighlightFallback(undefined)),
      () => undefined,
    );
  }, [threads]);
}
