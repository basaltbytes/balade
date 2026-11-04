import { Result } from "effect";
import { useMemo, type CSSProperties, type MouseEvent } from "react";
import { decodeDiffFiles, hostHref, totals, type DiffFile } from "./data/diff-files";
import type { Lang } from "./i18n";
import { Octicon } from "./ui/octicon";
import { RenderRuntimeProvider } from "./ui/render-runtime";
import { StringsProvider, useStrings } from "./ui/strings";
import { FileBrowser, FileRow } from "./widgets/file-browser";

export type { DiffFile, DiffPatch } from "./data/diff-files";

export interface DiffProps {
  /** Changed files, decoded at this boundary even for JavaScript consumers. */
  readonly files: ReadonlyArray<DiffFile>;
  /** Chrome language. Defaults to `"en"`. */
  readonly lang?: Lang;
  /** Opens every file's diff on first render, except generated files. Defaults to `false`. */
  readonly defaultExpanded?: boolean;
  /** The host's own view of a file; only HTTP, HTTPS and relative URLs render as links. */
  readonly fileHref?: (file: DiffFile) => string | undefined;
  /** Runs when the reader follows a file's link; call `preventDefault` to route in the app. */
  readonly onFileOpen?: (file: DiffFile, event: MouseEvent<HTMLElement>) => void;
  readonly className?: string;
  readonly style?: CSSProperties;
}

const LINK_CLASS = "shrink-0 text-muted-foreground hover:text-primary cursor-pointer";

function FileLink({
  file,
  fileHref,
  onFileOpen,
}: {
  file: DiffFile;
  fileHref: DiffProps["fileHref"];
  onFileOpen: DiffProps["onFileOpen"];
}) {
  const strings = useStrings();
  const requested = fileHref?.(file);
  const href = requested === undefined ? undefined : hostHref(requested);
  const label = strings.files.open(file.path);
  const onClick = onFileOpen && ((event: MouseEvent<HTMLElement>) => onFileOpen(file, event));
  if (href !== undefined) {
    return (
      <a
        href={href}
        aria-label={label}
        title={label}
        className={LINK_CLASS}
        {...(onClick ? { onClick } : {})}
      >
        <Octicon name="link-external" size={13} />
      </a>
    );
  }
  if (onClick === undefined) return null;
  return (
    <button type="button" aria-label={label} title={label} className={LINK_CLASS} onClick={onClick}>
      <Octicon name="link-external" size={13} />
    </button>
  );
}

function DiffFiles({
  files,
  defaultExpanded,
  fileHref,
  onFileOpen,
}: {
  files: DiffProps["files"];
  defaultExpanded: boolean;
  fileHref: DiffProps["fileHref"];
  onFileOpen: DiffProps["onFileOpen"];
}) {
  const strings = useStrings();
  const decoded = useMemo(() => decodeDiffFiles(files), [files]);
  if (Result.isFailure(decoded)) {
    return (
      <p role="alert" className="px-3 py-3 text-[12.5px]">
        {strings.files.unreadable}
      </p>
    );
  }
  const entries = decoded.success;
  return (
    <FileBrowser stats={totals(entries.map(({ row }) => row))}>
      {/* A path appears once per diff, so it keys its row. */}
      {entries.map(({ file, row }) => (
        <FileRow
          key={row.path}
          row={row}
          defaultOpen={defaultExpanded && !row.generated}
          link={<FileLink file={file} fileHref={fileHref} onFileOpen={onFileOpen} />}
        />
      ))}
    </FileBrowser>
  );
}

/** A pull request's changed files in the walkthrough's diff browser, without a walkthrough. */
export function Diff({
  files,
  lang = "en",
  defaultExpanded = false,
  fileHref,
  onFileOpen,
  className,
  style,
}: DiffProps) {
  return (
    <RenderRuntimeProvider>
      <StringsProvider lang={lang}>
        <div className={`balade-viewer ${className ?? ""}`} style={style} lang={lang}>
          <DiffFiles
            files={files}
            defaultExpanded={defaultExpanded}
            fileHref={fileHref}
            onFileOpen={onFileOpen}
          />
        </div>
      </StringsProvider>
    </RenderRuntimeProvider>
  );
}
