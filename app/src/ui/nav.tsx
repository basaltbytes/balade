/* The sidebar is the payload's nav tree, rendered as data, plus the review
   header: progress count and thin bar, the next-unreviewed jump, and the
   hide-reviewed toggle. */

import { useEffect, useState, type ReactNode } from "react";
import type { NavNode, Payload, Section } from "../contract";
import { sectionById } from "../data/review";
import { MarkButton, ProgressBar } from "./bits";
import { FileStatusIcon, Octicon, statusColor } from "./octicon";
import { useReview } from "./review-context";
import { useStrings } from "./strings";

function useActiveSection(): string {
  const [active, setActive] = useState("");
  useEffect(() => {
    const sections = Array.from(document.querySelectorAll("section[id]"));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        const first = visible[0];
        if (first) setActive(first.target.id);
      },
      { rootMargin: "0px 0px -70% 0px" },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);
  return active;
}

export function jumpTo(id: string): void {
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  window.history.replaceState(null, "", `#${id}`);
}

/** An in-page anchor that scrolls instead of navigating. */
export function JumpLink({
  id,
  className,
  title,
  children,
}: {
  id: string;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={`#${id}`}
      onClick={(event) => {
        event.preventDefault();
        jumpTo(id);
      }}
      {...(className !== undefined ? { className } : {})}
      {...(title !== undefined ? { title } : {})}
    >
      {children}
    </a>
  );
}

function NavLeaf({
  node,
  active,
  section,
}: {
  node: Extract<NavNode, { kind: "section" | "file" }>;
  active: boolean;
  section: Section | undefined;
}) {
  const review = useReview();
  const strings = useStrings();
  const reviewed = review.sectionReviewed(node.ref);
  const files = section ? review.filesOf(section) : null;
  return (
    <div
      className={`flex items-center gap-2 px-2 py-[5px] rounded-md border-l-2 ${
        active ? "border-primary bg-primary/10" : "border-transparent hover:bg-secondary/60"
      } ${reviewed && review.hideReviewed ? "opacity-50" : ""}`}
    >
      <MarkButton reviewed={reviewed} onToggle={() => review.markSection(node.ref)} compact />
      <JumpLink id={node.ref} className="flex items-center gap-2 min-w-0 flex-1">
        {node.kind === "file" ? (
          <>
            <FileStatusIcon status={node.status} size={13} />
            <span className={`font-mono text-[12px] truncate ${statusColor[node.status]}`}>
              {node.label}
            </span>
          </>
        ) : (
          <>
            <Octicon name={node.icon} size={14} className="text-muted-foreground shrink-0" />
            <span
              className={`truncate ${active ? "text-foreground" : "text-secondary-foreground"}`}
            >
              {node.label}
            </span>
          </>
        )}
      </JumpLink>
      {files && (
        <span className="shrink-0 text-[10.5px] text-muted-foreground tabular-nums">
          {strings.filesViewed(files.done, files.total)}
        </span>
      )}
    </div>
  );
}

function NavTree({
  nodes,
  active,
  sections,
  depth,
}: {
  nodes: ReadonlyArray<NavNode>;
  active: string;
  sections: Map<string, Section>;
  depth: number;
}) {
  return (
    <>
      {nodes.map((node, index) =>
        node.kind === "group" ? (
          <div key={`${node.label}-${index}`} className={depth === 0 ? "mb-4" : "mb-2 ml-2"}>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5 px-2">
              {node.label}
            </div>
            <NavTree nodes={node.children} active={active} sections={sections} depth={depth + 1} />
          </div>
        ) : (
          <NavLeaf
            key={node.ref}
            node={node}
            active={active === node.ref}
            section={sections.get(node.ref)}
          />
        ),
      )}
    </>
  );
}

export function Nav({ payload }: { payload: Payload }) {
  const active = useActiveSection();
  const review = useReview();
  const strings = useStrings();
  const sections = sectionById(payload);

  return (
    <nav className="text-[13px] leading-tight">
      <div className="mb-5 pb-4 border-b border-border">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-[12px] text-secondary-foreground tabular-nums">
            {strings.progress(review.progress.done, review.progress.total)}
          </span>
          {review.complete && <Octicon name="check-circle-fill" size={14} className="text-added" />}
        </div>
        <ProgressBar done={review.progress.done} total={review.progress.total} />
        <div className="flex items-center flex-wrap gap-2 mt-3">
          <button
            type="button"
            onClick={() => {
              const next = review.next(active === "" ? undefined : active);
              if (next) jumpTo(next);
            }}
            disabled={review.complete}
            className="inline-flex items-center gap-1.5 text-[11.5px] border border-border rounded-md px-2 py-[3px] text-secondary-foreground hover:text-foreground hover:border-primary disabled:opacity-40 disabled:hover:border-border cursor-pointer disabled:cursor-default"
          >
            <Octicon name="arrow-right" size={12} />
            {strings.nextUnreviewed}
          </button>
          <button
            type="button"
            onClick={() => review.setHideReviewed(!review.hideReviewed)}
            aria-pressed={review.hideReviewed}
            className={`inline-flex items-center gap-1.5 text-[11.5px] border rounded-md px-2 py-[3px] cursor-pointer ${
              review.hideReviewed
                ? "border-primary/50 bg-primary/10 text-foreground"
                : "border-border text-secondary-foreground hover:text-foreground hover:border-primary"
            }`}
          >
            <Octicon name="eye" size={12} />
            {review.hideReviewed ? strings.showReviewed : strings.hideReviewed}
          </button>
        </div>
      </div>
      <NavTree nodes={payload.nav} active={active} sections={sections} depth={0} />
    </nav>
  );
}
