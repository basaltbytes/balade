/* The GitHub-style file diff browser shared by `{% files %}` and the public
   `Diff` component: every row opens its own diff, split or unified, with
   expand-context when the row carries the full old/new contents. Callers
   supply what only they know: the row link, a note and the Viewed control. */

import { DiffModeEnum, DiffView } from "@git-diff-view/react";
import { useMemo, useState, type ReactNode } from "react";
import { hasHunk, normalizeUnified, splitPath } from "../data/diff";
import type { DiffRow, Totals } from "../data/diff-files";
import { useDiffHighlighter } from "../highlight/diff-highlighter";
import { hasOverlongHighlightLine } from "../highlight/shiki";
import { Chip } from "../ui/bits";
import { Octicon, FileStatusIcon } from "../ui/octicon";
import { useStrings } from "../ui/strings";

function ChangeBar({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions;
  const green = total === 0 ? 0 : Math.round((additions / total) * 5);
  return (
    <span className="hidden sm:inline-flex gap-[2px] shrink-0">
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

export interface ViewedToggle {
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onToggle: () => void;
}

export interface FileRowProps {
  readonly row: DiffRow;
  readonly defaultOpen: boolean;
  readonly link?: ReactNode;
  readonly note?: ReactNode;
  readonly viewed?: ViewedToggle;
}

function Notice({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <p className="px-3 py-3 text-[12.5px] text-muted-foreground inline-flex items-center gap-2">
      <Octicon name={icon} size={14} />
      {children}
    </p>
  );
}

function Banner({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b border-border-soft text-[12px] text-muted-foreground">
      <Octicon name="info" size={14} className="shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export function FileRow({ row, defaultOpen, link, note, viewed }: FileRowProps) {
  const strings = useStrings();
  const [open, setOpen] = useState(defaultOpen);
  const [mode, setMode] = useState<DiffModeEnum>(DiffModeEnum.Unified);
  const highlighter = useDiffHighlighter([row.lang]);
  const [dir, name] = splitPath(row.path);
  const { patch } = row;
  const highlightSkipped =
    open &&
    patch.kind === "text" &&
    [patch.unified, patch.oldContent, patch.newContent].some(
      (content) => content !== null && hasOverlongHighlightLine(content),
    );

  const data = useMemo(() => {
    if (patch.kind !== "text" || !hasHunk(patch.unified)) return null;
    return {
      oldFile: {
        fileName: row.oldPath ?? row.path,
        fileLang: row.lang,
        content: patch.oldContent,
      },
      newFile: { fileName: row.path, fileLang: row.lang, content: patch.newContent },
      hunks: [normalizeUnified(patch.unified, row.path, row.oldPath)],
    };
  }, [patch, row.path, row.oldPath, row.lang]);

  return (
    <div
      className={`border-b border-border-soft last:border-b-0 ${viewed?.checked === true ? "reviewed-file" : ""}`}
    >
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
          <span title={strings.files.status[row.status]}>
            <FileStatusIcon status={row.status} />
          </span>
          <span className="font-mono truncate">
            <span className="text-muted-foreground">{dir}</span>
            <span className="text-foreground">{name}</span>
          </span>
          {row.status === "R" && row.oldPath !== undefined && (
            <span className="text-[11px] text-muted-foreground truncate hidden sm:inline">
              {strings.files.renamedFrom(row.oldPath)}
            </span>
          )}
          {row.test && (
            <span className="shrink-0">
              <Chip icon="beaker">{strings.files.test}</Chip>
            </span>
          )}
          {row.generated && (
            <span className="shrink-0">
              <Chip icon="gear">{strings.files.generated}</Chip>
            </span>
          )}
        </button>
        {link}
        <span className="font-mono text-added shrink-0">+{row.additions}</span>
        <span
          className={`font-mono shrink-0 ${row.deletions > 0 ? "text-removed" : "text-context"}`}
        >
          −{row.deletions}
        </span>
        <ChangeBar additions={row.additions} deletions={row.deletions} />
        {viewed !== undefined && (
          <label className="inline-flex items-center gap-1.5 text-[11.5px] text-secondary-foreground cursor-pointer shrink-0 select-none">
            <input
              type="checkbox"
              checked={viewed.checked}
              onChange={viewed.onToggle}
              disabled={viewed.disabled}
              className="accent-primary"
            />
            {strings.files.viewed}
          </label>
        )}
      </div>

      {note}

      {open && (
        <div className="file-body border-t border-border-soft bg-background">
          {patch.kind === "binary" ? (
            <Notice icon="file-binary">{strings.files.binary}</Notice>
          ) : patch.kind === "omitted" ? (
            <Notice icon="info">{strings.files.omitted}</Notice>
          ) : data === null ? (
            <Notice icon="info">{strings.files.unchanged}</Notice>
          ) : (
            <>
              {patch.truncated && <Banner>{strings.files.truncated}</Banner>}
              {highlightSkipped && <Banner>{strings.highlightSkippedLongLine}</Banner>}
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

/** The bordered browser with its stats head; rows and groups go inside. */
export function FileBrowser({ stats, children }: { stats: Totals; children: ReactNode }) {
  const strings = useStrings();
  return (
    <div className="my-4 border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-[10px] bg-muted border-b border-border text-[13px] text-muted-foreground">
        <Octicon name="file-diff" size={14} />
        {strings.files.header(stats.files, stats.additions, stats.deletions)}
      </div>
      {children}
    </div>
  );
}
