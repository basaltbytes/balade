/* The payload carries octicon *names*; the renderer owns the mapping.
   The 31 names of the v0 sprite plus `unfold` for diff context expansion, and
   the handful the chrome itself needs. */

import {
  AlertIcon,
  ArrowRightIcon,
  BeakerIcon,
  BookIcon,
  CheckCircleFillIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleIcon,
  CodeSquareIcon,
  ColumnsIcon,
  DashIcon,
  DatabaseIcon,
  DiffAddedIcon,
  DiffModifiedIcon,
  DiffRemovedIcon,
  DiffRenamedIcon,
  DotFillIcon,
  EyeIcon,
  FileAddedIcon,
  FileBinaryIcon,
  FileCodeIcon,
  FileDiffIcon,
  FileIcon,
  GearIcon,
  GitBranchIcon,
  GitCommitIcon,
  GitCompareIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  GlobeIcon,
  GraphIcon,
  InfoIcon,
  LawIcon,
  LightBulbIcon,
  LinkExternalIcon,
  LinkIcon,
  ListUnorderedIcon,
  PackageIcon,
  PersonIcon,
  QuestionIcon,
  RepoIcon,
  RowsIcon,
  ShieldLockIcon,
  TableIcon,
  UnfoldIcon,
  XIcon,
} from "@primer/octicons-react";
import type { ComponentType } from "react";
import type { FileStatus } from "../contract";

type IconComponent = ComponentType<{ size?: number; className?: string }>;

const ICONS: Record<string, IconComponent> = {
  alert: AlertIcon,
  "arrow-right": ArrowRightIcon,
  beaker: BeakerIcon,
  book: BookIcon,
  check: CheckIcon,
  "check-circle-fill": CheckCircleFillIcon,
  "chevron-down": ChevronDownIcon,
  "chevron-right": ChevronRightIcon,
  circle: CircleIcon,
  "code-square": CodeSquareIcon,
  columns: ColumnsIcon,
  dash: DashIcon,
  database: DatabaseIcon,
  "diff-added": DiffAddedIcon,
  "diff-modified": DiffModifiedIcon,
  "diff-removed": DiffRemovedIcon,
  "diff-renamed": DiffRenamedIcon,
  "dot-fill": DotFillIcon,
  eye: EyeIcon,
  file: FileIcon,
  "file-added": FileAddedIcon,
  "file-binary": FileBinaryIcon,
  "file-code": FileCodeIcon,
  "file-diff": FileDiffIcon,
  gear: GearIcon,
  "git-branch": GitBranchIcon,
  "git-commit": GitCommitIcon,
  "git-compare": GitCompareIcon,
  "git-merge": GitMergeIcon,
  "git-pull-request": GitPullRequestIcon,
  globe: GlobeIcon,
  graph: GraphIcon,
  info: InfoIcon,
  law: LawIcon,
  "light-bulb": LightBulbIcon,
  link: LinkIcon,
  "link-external": LinkExternalIcon,
  "list-unordered": ListUnorderedIcon,
  package: PackageIcon,
  person: PersonIcon,
  question: QuestionIcon,
  repo: RepoIcon,
  rows: RowsIcon,
  "shield-lock": ShieldLockIcon,
  table: TableIcon,
  unfold: UnfoldIcon,
  x: XIcon,
};

export function Octicon({
  name,
  size = 16,
  className = "",
}: {
  name: string | undefined;
  size?: number;
  className?: string;
}) {
  const Icon = (name === undefined ? undefined : ICONS[name]) ?? DotFillIcon;
  return <Icon size={size} className={className} />;
}

export const statusColor: Record<FileStatus, string> = {
  A: "text-added",
  M: "text-modified",
  D: "text-removed",
  R: "text-accent-muted",
};

const STATUS_ICON: Record<FileStatus, string> = {
  A: "diff-added",
  M: "diff-modified",
  D: "diff-removed",
  R: "diff-renamed",
};

export function FileStatusIcon({
  status,
  size = 14,
  className,
}: {
  status: FileStatus;
  size?: number;
  className?: string;
}) {
  return (
    <Octicon
      name={STATUS_ICON[status]}
      size={size}
      className={`${statusColor[status]} shrink-0 ${className ?? ""}`}
    />
  );
}
