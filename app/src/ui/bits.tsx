/* Small shared chrome pieces: the thin progress bar, chips, banners and the
   two shapes of the "Mark reviewed" control. */

import type { ReactNode } from "react";
import { Octicon } from "./octicon";
import { useStrings } from "./strings";

export function ProgressBar({
  done,
  total,
  className,
}: {
  done: number;
  total: number;
  className?: string;
}) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const full = total > 0 && done === total;
  return (
    <span
      className={`block h-[3px] rounded-full bg-secondary overflow-hidden ${className ?? ""}`}
      role="progressbar"
      aria-valuenow={done}
      aria-valuemin={0}
      aria-valuemax={total}
    >
      <span
        className={`block h-full rounded-full transition-[width] duration-200 ${full ? "bg-added" : "bg-primary"}`}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

const TONES: Record<string, string> = {
  neutral: "text-secondary-foreground bg-secondary border-border",
  new: "text-added bg-added/12 border-added/32",
  mod: "text-modified bg-modified/12 border-modified/32",
  del: "text-removed bg-removed/12 border-removed/32",
  key: "text-primary bg-primary/12 border-primary/32",
  done: "text-done bg-done/12 border-done/32",
};

export function Chip({
  tone = "neutral",
  icon,
  children,
}: {
  tone?: keyof typeof TONES | string;
  icon?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] border rounded-md px-[7px] py-[2px] whitespace-nowrap ${TONES[tone] ?? TONES.neutral}`}
    >
      {icon && <Octicon name={icon} size={12} />}
      {children}
    </span>
  );
}

const BANNER_TONES: Record<string, string> = {
  warn: "border-modified/50 bg-modified/10 text-secondary-foreground",
  error: "border-destructive/50 bg-destructive/10 text-secondary-foreground",
  key: "border-primary/50 bg-primary/10 text-secondary-foreground",
  done: "border-added/50 bg-added/10 text-secondary-foreground",
};

export function Banner({
  tone,
  icon,
  title,
  children,
  onDismiss,
}: {
  tone: keyof typeof BANNER_TONES;
  icon: string;
  title: ReactNode;
  children?: ReactNode;
  onDismiss?: () => void;
}) {
  const strings = useStrings();
  return (
    <div className={`my-4 border rounded-md px-4 py-3 flex gap-3 ${BANNER_TONES[tone]}`}>
      <Octicon name={icon} size={16} className="mt-[2px] shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-foreground text-[13.5px]">{title}</div>
        {children && <div className="text-[13px] leading-relaxed mt-1">{children}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={strings.dismiss}
          className="shrink-0 text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <Octicon name="x" size={14} />
        </button>
      )}
    </div>
  );
}

export function MarkButton({
  reviewed,
  onToggle,
  compact,
}: {
  reviewed: boolean;
  onToggle: () => void;
  compact?: boolean;
}) {
  const strings = useStrings();
  const label = reviewed ? strings.reviewed : strings.markReviewed;
  if (compact) {
    return (
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-pressed={reviewed}
        onClick={onToggle}
        className={`shrink-0 cursor-pointer ${reviewed ? "text-added" : "text-muted-foreground/50 hover:text-muted-foreground"}`}
      >
        <Octicon name={reviewed ? "check-circle-fill" : "circle"} size={13} />
      </button>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={reviewed}
      onClick={onToggle}
      className={`inline-flex items-center gap-2 text-[12.5px] border rounded-md px-3 py-[5px] cursor-pointer ${
        reviewed
          ? "text-added border-added/40 bg-added/10"
          : "text-secondary-foreground border-border hover:border-primary hover:text-foreground"
      }`}
    >
      <Octicon name={reviewed ? "check-circle-fill" : "check"} size={14} />
      {label}
    </button>
  );
}
