/* The zero-argument route: one row per discovered walkthrough, with the
   staleness badge arriving after the page is already on screen. */

import { Option } from "effect";
import { useEffect, useState } from "react";
import type { IndexEntry, IndexPayload } from "../contract";
import { runAppEffect } from "../data/runtime";
import { fetchHeadDistance, hrefFor } from "../data/source";
import { Chip, ProgressBar } from "../ui/bits";
import { Octicon } from "../ui/octicon";
import { useStrings } from "../ui/strings";

function useHeadDistance(path: string): number | null {
  const [distance, setDistance] = useState<number | null>(null);
  useEffect(() => {
    return runAppEffect(fetchHeadDistance(path), (value) => {
      setDistance(Option.getOrNull(value));
    });
  }, [path]);
  return distance;
}

/* One formatter per locale: the Intl constructor is expensive and every row wants the same one. */
const dateFormats = new Map<string, Intl.DateTimeFormat>();
function dateFormat(locale: string): Intl.DateTimeFormat {
  let format = dateFormats.get(locale);
  if (format === undefined) {
    format = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
    dateFormats.set(locale, format);
  }
  return format;
}

function Row({ entry, locale }: { entry: IndexEntry; locale: string }) {
  const strings = useStrings();
  const distance = useHeadDistance(entry.path);
  const progress = entry.progress;
  const date = new Date(entry.updatedAt);
  const updated = Number.isNaN(date.getTime()) ? entry.updatedAt : dateFormat(locale).format(date);

  return (
    <a
      href={hrefFor(entry.path)}
      className="block border-b border-border-soft last:border-b-0 px-4 py-3 hover:bg-accent"
    >
      <div className="flex items-center flex-wrap gap-2">
        <Octicon name="git-pull-request" size={15} className="text-open shrink-0" />
        <span className="font-semibold text-[14.5px] text-foreground">{entry.title}</span>
        <span className="text-muted-foreground">#{entry.pr}</span>
        <span className="ml-auto text-[12px] text-muted-foreground">
          {strings.index.updated(updated)}
        </span>
      </div>
      <div className="mt-2 flex items-center flex-wrap gap-3">
        <span className="text-[12px] text-secondary-foreground tabular-nums">
          {progress ? strings.progress(progress.done, progress.total) : strings.index.neverOpened}
        </span>
        <ProgressBar
          done={progress?.done ?? 0}
          total={progress?.total ?? 1}
          className="w-[140px]"
        />
        {distance !== null &&
          (distance > 0 ? (
            <Chip tone="mod" icon="alert">
              {strings.index.stale(distance)}
            </Chip>
          ) : (
            <Chip tone="new" icon="check">
              {strings.index.upToDate}
            </Chip>
          ))}
        {Object.entries(entry.meta).map(([key, value]) => (
          <Chip key={key}>
            {key}={value}
          </Chip>
        ))}
      </div>
      <div className="mt-1.5 font-mono text-[11.5px] text-muted-foreground truncate">
        {entry.path}
      </div>
    </a>
  );
}

export function IndexRoute({ payload, locale }: { payload: IndexPayload; locale: string }) {
  const strings = useStrings();

  useEffect(() => {
    document.title = `balade · ${payload.repo}`;
  }, [payload.repo]);

  return (
    <div className="mx-auto max-w-[900px] px-6 py-10">
      <header className="mb-6 pb-4 border-b border-border">
        <h1 className="text-[22px] font-semibold flex items-center gap-2">
          <Octicon name="repo" size={18} className="text-muted-foreground" />
          {strings.index.title}
        </h1>
        <p className="text-muted-foreground mt-1">{strings.index.subtitle(payload.repo)}</p>
      </header>
      {payload.entries.length === 0 ? (
        <p className="text-muted-foreground">{strings.index.empty}</p>
      ) : (
        <div className="border border-border rounded-md overflow-hidden">
          {payload.entries.map((entry) => (
            <Row key={entry.path} entry={entry} locale={locale} />
          ))}
        </div>
      )}
    </div>
  );
}
