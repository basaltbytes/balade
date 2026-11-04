/* {% files %} renders the payload's file entries through the shared file
   browser, adding what only a walkthrough has: authored groups, the section
   link, the author's note and the per-file "Viewed" checkbox that feeds the
   review state. */

import { useMemo, useState } from "react";
import type { FileEntry, FileGroup } from "../contract";
import { rowOfEntry, totals } from "../data/diff-files";
import { fileByPath } from "../data/review";
import { JumpLink } from "../ui/nav";
import { Octicon } from "../ui/octicon";
import { usePayload } from "../ui/payload-context";
import { Rich } from "../ui/rich";
import { useReview, useSectionId } from "../ui/review-context";
import { useStrings } from "../ui/strings";
import { FileBrowser, FileRow } from "./file-browser";

function EntryRow({ entry }: { entry: FileEntry }) {
  const review = useReview();
  const sectionId = useSectionId();
  const row = useMemo(() => rowOfEntry(entry), [entry]);
  const sectionRef = entry.ref;

  return (
    <FileRow
      row={row}
      defaultOpen={false}
      link={
        sectionRef !== undefined && (
          <JumpLink
            id={sectionRef}
            title={sectionRef}
            className="shrink-0 text-muted-foreground hover:text-primary"
          >
            <Octicon name="link" size={13} />
          </JumpLink>
        )
      }
      note={
        entry.why !== undefined && (
          <p className="file-head px-3 pb-2 -mt-1 text-[12px] text-muted-foreground leading-relaxed">
            <Rich v={entry.why} />
          </p>
        )
      }
      viewed={{
        checked: review.fileViewed(sectionId, entry.path),
        disabled: !review.ready,
        onToggle: () => review.markFile(sectionId, entry.path),
      }}
    />
  );
}

/* A path the pull request never touched still gets a row: silently dropping it
   would hide an authoring mistake instead of naming it. */
function Rows({ paths }: { paths: ReadonlyArray<string> }) {
  const strings = useStrings();
  const byPath = fileByPath(usePayload());

  return (
    <>
      {paths.map((path) => {
        const entry = byPath.get(path);
        return entry ? (
          <EntryRow key={path} entry={entry} />
        ) : (
          <div
            key={path}
            className="px-3 py-[7px] text-[12.5px] text-muted-foreground border-b border-border-soft last:border-b-0"
          >
            {strings.files.missing(path)}
          </div>
        );
      })}
    </>
  );
}

/** What a path list adds up to; the paths the payload knows nothing about count for nothing. */
function pathTotals(byPath: Map<string, FileEntry>, paths: ReadonlyArray<string>) {
  return totals(
    paths.flatMap((path) => {
      const entry = byPath.get(path);
      return entry ? [entry] : [];
    }),
  );
}

/* An authored theme over the rows. It starts collapsed — the point of grouping a
   long browser is that the reader opens one theme at a time — and its head
   carries the same stats sentence as the browser's own, scoped to the group. */
function Group({ group }: { group: FileGroup }) {
  const strings = useStrings();
  const [open, setOpen] = useState(false);
  const stats = pathTotals(fileByPath(usePayload()), group.paths);

  return (
    <div className="border-b border-border-soft last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-[8px] bg-muted text-[12.5px] text-muted-foreground cursor-pointer text-left"
      >
        <Octicon name={open ? "chevron-down" : "chevron-right"} size={13} className="shrink-0" />
        <Octicon name="rows" size={13} className="shrink-0" />
        {/* Authored, pull-request-derived text: a React child, never markup. */}
        <span className="text-foreground truncate">{group.label}</span>
        <span className="ml-auto shrink-0">
          {strings.files.header(stats.files, stats.additions, stats.deletions)}
        </span>
      </button>
      {open && (
        <div className="border-t border-border-soft">
          <Rows paths={group.paths} />
        </div>
      )}
    </div>
  );
}

export function Files({
  paths,
  groups,
}: {
  paths: ReadonlyArray<string>;
  groups?: ReadonlyArray<FileGroup>;
}) {
  const byPath = fileByPath(usePayload());
  /* Groups partition the browser, so the head still counts the whole thing. */
  const stats = pathTotals(byPath, [...(groups ?? []).flatMap((group) => group.paths), ...paths]);

  return (
    <FileBrowser stats={stats}>
      {/* Authored order, and labels are free text: the position is the only stable key. */}
      {groups?.map((group, index) => (
        <Group key={index} group={group} />
      ))}
      <Rows paths={paths} />
    </FileBrowser>
  );
}
