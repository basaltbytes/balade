/* {% files %} is a GitHub-style per-file diff browser: every row opens its own
   diff, split or unified, with expand-context off the full old/new contents and
   a per-file "Viewed" checkbox that feeds the review state. */

import { DiffModeEnum, DiffView } from "@git-diff-view/react";
import { useMemo, useState } from "react";
import type { FileEntry, FileGroup } from "../contract";
import { normalizeUnified, splitPath } from "../data/diff";
import { fileByPath } from "../data/review";
import { useDiffHighlighter } from "../highlight/diff-highlighter";
import { hasOverlongHighlightLine } from "../highlight/shiki";
import { JumpLink } from "../ui/nav";
import { Octicon, FileStatusIcon } from "../ui/octicon";
import { usePayload } from "../ui/payload-context";
import { Rich } from "../ui/rich";
import { useReview, useSectionId } from "../ui/review-context";
import { useStrings } from "../ui/strings";

function ChangeBar({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions;
  const green = total === 0 ? 0 : Math.round((additions / total) * 5);
  return (
    <span className="inline-flex gap-[2px] shrink-0">
      {Array.from({ length: 5 }, (_, index) => (
        <i
          key={index}
          className={`w-[8px] h-[8px] rounded-[2px] ${
            total === 0 ? "bg-border-soft" : index < green ? "bg-added" : "bg-removed"
          }`}
        />
      ))}
    </span>
  );
}

function FileRow({ entry }: { entry: FileEntry }) {
  const strings = useStrings();
  const review = useReview();
  const sectionId = useSectionId();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<DiffModeEnum>(DiffModeEnum.Unified);
  const highlighter = useDiffHighlighter([entry.lang]);
  const viewed = review.fileViewed(sectionId, entry.path);
  const [dir, name] = splitPath(entry.path);
  const sectionRef = entry.ref;
  const highlightSkipped =
    open &&
    entry.diff !== null &&
    [entry.diff.unified, entry.diff.oldContent, entry.diff.newContent].some(
      (content) => content !== null && hasOverlongHighlightLine(content),
    );

  const data = useMemo(() => {
    if (!entry.diff) return null;
    return {
      oldFile: {
        fileName: entry.oldPath ?? entry.path,
        fileLang: entry.lang,
        content: entry.diff.oldContent,
      },
      newFile: { fileName: entry.path, fileLang: entry.lang, content: entry.diff.newContent },
      hunks: [normalizeUnified(entry.diff.unified, entry.path, entry.oldPath)],
    };
  }, [entry]);

  return (
    <div className={`border-b border-border-soft last:border-b-0 ${viewed ? "reviewed-file" : ""}`}>
      <div className="file-head flex items-center gap-3 px-3 py-[7px] text-[12.5px]">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="inline-flex items-center gap-2 min-w-0 flex-1 cursor-pointer text-left"
        >
          <Octicon
            name={open ? "chevron-down" : "chevron-right"}
            size={13}
            className="text-muted-foreground shrink-0"
          />
          <span title={strings.files.status[entry.status]}>
            <FileStatusIcon status={entry.status} />
          </span>
          <span className="font-mono truncate">
            <span className="text-muted-foreground">{dir}</span>
            <span className="text-foreground">{name}</span>
          </span>
          {entry.status === "R" && entry.oldPath !== undefined && (
            <span className="text-[11px] text-muted-foreground truncate hidden sm:inline">
              {strings.files.renamedFrom(entry.oldPath)}
            </span>
          )}
        </button>
        {sectionRef !== undefined && (
          <JumpLink
            id={sectionRef}
            title={sectionRef}
            className="shrink-0 text-muted-foreground hover:text-primary"
          >
            <Octicon name="link" size={13} />
          </JumpLink>
        )}
        <span className="font-mono text-added shrink-0">+{entry.additions}</span>
        <span
          className={`font-mono shrink-0 ${entry.deletions > 0 ? "text-removed" : "text-context"}`}
        >
          −{entry.deletions}
        </span>
        <ChangeBar additions={entry.additions} deletions={entry.deletions} />
        <label className="inline-flex items-center gap-1.5 text-[11.5px] text-secondary-foreground cursor-pointer shrink-0 select-none">
          <input
            type="checkbox"
            checked={viewed}
            onChange={() => review.markFile(sectionId, entry.path)}
            disabled={!review.ready}
            className="accent-primary"
          />
          {strings.files.viewed}
        </label>
      </div>

      {entry.why !== undefined && (
        <p className="file-head px-3 pb-2 -mt-1 text-[12px] text-muted-foreground leading-relaxed">
          <Rich v={entry.why} />
        </p>
      )}

      {open && (
        <div className="file-body border-t border-border-soft bg-background">
          {data === null ? (
            <p className="px-3 py-3 text-[12.5px] text-muted-foreground inline-flex items-center gap-2">
              <Octicon name="file-binary" size={14} />
              {strings.files.binary}
            </p>
          ) : (
            <>
              {highlightSkipped && (
                <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b border-border-soft text-[12px] text-muted-foreground">
                  <Octicon name="info" size={14} className="shrink-0" />
                  <span>{strings.highlightSkippedLongLine}</span>
                </div>
              )}
              <div className="flex items-center justify-end gap-1 px-3 py-2 border-b border-border-soft text-[11px]">
                {(
                  [
                    [DiffModeEnum.Unified, strings.files.unified],
                    [DiffModeEnum.Split, strings.files.split],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setMode(value)}
                    className={`px-2 py-[2px] rounded-md border cursor-pointer ${
                      mode === value
                        ? "border-primary/50 text-foreground bg-primary/10"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="text-[12px]" data-theme="dark">
                <DiffView
                  data={data}
                  diffViewMode={mode}
                  diffViewTheme="dark"
                  diffViewHighlight={highlighter !== undefined}
                  diffViewFontSize={12}
                  diffViewWrap={false}
                  {...(highlighter ? { registerHighlighter: highlighter } : {})}
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
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
          <FileRow key={path} entry={entry} />
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
function totals(byPath: Map<string, FileEntry>, paths: ReadonlyArray<string>) {
  const known = paths.flatMap((path) => {
    const entry = byPath.get(path);
    return entry ? [entry] : [];
  });
  return {
    files: known.length,
    additions: known.reduce((sum, entry) => sum + entry.additions, 0),
    deletions: known.reduce((sum, entry) => sum + entry.deletions, 0),
  };
}

/* An authored theme over the rows. It starts collapsed — the point of grouping a
   long browser is that the reader opens one theme at a time — and its head
   carries the same stats sentence as the browser's own, scoped to the group. */
function Group({ group }: { group: FileGroup }) {
  const strings = useStrings();
  const [open, setOpen] = useState(false);
  const stats = totals(fileByPath(usePayload()), group.paths);

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
  const strings = useStrings();
  const byPath = fileByPath(usePayload());
  /* Groups partition the browser, so the head still counts the whole thing. */
  const stats = totals(byPath, [...(groups ?? []).flatMap((group) => group.paths), ...paths]);

  return (
    <div className="my-4 border border-border rounded-md overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-[10px] bg-muted border-b border-border text-[13px] text-muted-foreground">
        <Octicon name="file-diff" size={14} />
        {strings.files.header(stats.files, stats.additions, stats.deletions)}
      </div>
      {/* Authored order, and labels are free text: the position is the only stable key. */}
      {groups?.map((group, index) => (
        <Group key={index} group={group} />
      ))}
      <Rows paths={paths} />
    </div>
  );
}
