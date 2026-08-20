/* The payload carries octicon *names*; the renderer owns the mapping.
   The 31 names of the v0 sprite plus `unfold` for diff context expansion, and
   the handful the chrome itself needs. */

import {
  AccessibilityIcon,
  AgentIcon,
  AiModelIcon,
  AlertIcon,
  ArrowRightIcon,
  BeakerIcon,
  BookIcon,
  BrowserIcon,
  BugIcon,
  CheckCircleFillIcon,
  CheckIcon,
  ChecklistIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleIcon,
  ClockIcon,
  CloudIcon,
  CodeSquareIcon,
  CodescanIcon,
  ColumnsIcon,
  CommentDiscussionIcon,
  ContainerIcon,
  CpuIcon,
  DashIcon,
  DatabaseIcon,
  DependabotIcon,
  DeviceMobileIcon,
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
  FilterIcon,
  GearIcon,
  GitBranchIcon,
  GitCommitIcon,
  GitCompareIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  GlobeIcon,
  GraphIcon,
  HistoryIcon,
  ImageIcon,
  InfoIcon,
  IssueOpenedIcon,
  IterationsIcon,
  KeyIcon,
  LawIcon,
  LightBulbIcon,
  LinkExternalIcon,
  LinkIcon,
  ListUnorderedIcon,
  LockIcon,
  LogIcon,
  MeterIcon,
  MilestoneIcon,
  NoteIcon,
  OrganizationIcon,
  PackageIcon,
  PaintbrushIcon,
  PencilIcon,
  PeopleIcon,
  PersonIcon,
  QuestionIcon,
  RepoIcon,
  RowsIcon,
  SearchIcon,
  ServerIcon,
  ShieldCheckIcon,
  ShieldLockIcon,
  SlidersIcon,
  StackIcon,
  StopwatchIcon,
  SyncIcon,
  TableIcon,
  TagIcon,
  TerminalIcon,
  ToolsIcon,
  TypographyIcon,
  UnfoldIcon,
  VersionsIcon,
  WorkflowIcon,
  XIcon,
} from "@primer/octicons-react";
import type { ComponentType } from "react";
import type { FileStatus } from "../contract";
import type { IconName } from "./icon-names";

type IconComponent = ComponentType<{ size?: number; className?: string }>;

/* `satisfies` makes the compiler reject a name the list does not hold, and a
   list entry the map does not answer. */
const ICONS = new Map<string, IconComponent>(
  Object.entries({
    accessibility: AccessibilityIcon,
    agent: AgentIcon,
    "ai-model": AiModelIcon,
    alert: AlertIcon,
    "arrow-right": ArrowRightIcon,
    beaker: BeakerIcon,
    book: BookIcon,
    browser: BrowserIcon,
    bug: BugIcon,
    check: CheckIcon,
    "check-circle-fill": CheckCircleFillIcon,
    checklist: ChecklistIcon,
    "chevron-down": ChevronDownIcon,
    "chevron-right": ChevronRightIcon,
    circle: CircleIcon,
    clock: ClockIcon,
    cloud: CloudIcon,
    "code-square": CodeSquareIcon,
    codescan: CodescanIcon,
    columns: ColumnsIcon,
    "comment-discussion": CommentDiscussionIcon,
    container: ContainerIcon,
    cpu: CpuIcon,
    dash: DashIcon,
    database: DatabaseIcon,
    dependabot: DependabotIcon,
    "device-mobile": DeviceMobileIcon,
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
    filter: FilterIcon,
    gear: GearIcon,
    "git-branch": GitBranchIcon,
    "git-commit": GitCommitIcon,
    "git-compare": GitCompareIcon,
    "git-merge": GitMergeIcon,
    "git-pull-request": GitPullRequestIcon,
    globe: GlobeIcon,
    graph: GraphIcon,
    history: HistoryIcon,
    image: ImageIcon,
    info: InfoIcon,
    "issue-opened": IssueOpenedIcon,
    iterations: IterationsIcon,
    key: KeyIcon,
    law: LawIcon,
    "light-bulb": LightBulbIcon,
    link: LinkIcon,
    "link-external": LinkExternalIcon,
    "list-unordered": ListUnorderedIcon,
    lock: LockIcon,
    log: LogIcon,
    meter: MeterIcon,
    milestone: MilestoneIcon,
    note: NoteIcon,
    organization: OrganizationIcon,
    package: PackageIcon,
    paintbrush: PaintbrushIcon,
    pencil: PencilIcon,
    people: PeopleIcon,
    person: PersonIcon,
    question: QuestionIcon,
    repo: RepoIcon,
    rows: RowsIcon,
    search: SearchIcon,
    server: ServerIcon,
    "shield-check": ShieldCheckIcon,
    "shield-lock": ShieldLockIcon,
    sliders: SlidersIcon,
    stack: StackIcon,
    stopwatch: StopwatchIcon,
    sync: SyncIcon,
    table: TableIcon,
    tag: TagIcon,
    terminal: TerminalIcon,
    tools: ToolsIcon,
    typography: TypographyIcon,
    unfold: UnfoldIcon,
    versions: VersionsIcon,
    workflow: WorkflowIcon,
    x: XIcon,
  } satisfies Record<IconName, IconComponent>),
);

export function Octicon({
  name,
  size = 16,
  className = "",
}: {
  name: string | undefined;
  size?: number;
  className?: string;
}) {
  const Icon = (name === undefined ? undefined : ICONS.get(name)) ?? DotFillIcon;
  return <Icon size={size} className={className} />;
}

export const statusColor = {
  A: "text-added",
  M: "text-modified",
  D: "text-removed",
  R: "text-accent-muted",
} satisfies Record<FileStatus, string>;

const STATUS_ICON = {
  A: "diff-added",
  M: "diff-modified",
  D: "diff-removed",
  R: "diff-renamed",
} satisfies Record<FileStatus, string>;

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
