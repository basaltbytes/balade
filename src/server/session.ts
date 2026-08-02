/**
 * What `open` puts together before the port opens: which walkthroughs this run
 * serves, the payload cache in front of the resolver, the review-state files,
 * and a watcher that drops a cached payload when its file changes.
 *
 * Nothing here throws and nothing here is an Effect: preparing either answers a
 * session, a note saying there is nothing to serve, or the check outcome that
 * stopped it.
 */

import { realpathSync, watch, type FSWatcher } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import { discoverWalkthroughs, NO_WALKTHROUGH } from "../check/discover.js";
import type { CheckOutcome } from "../check/run.js";
import { gitOut } from "../resolve/exec.js";
import { fileReviewStore } from "../state/store.js";
import { createApi, type Api } from "./api.js";
import { payloadCache, type PayloadCache } from "./cache.js";
import { serverRepo, type ServerRepo } from "./repo.js";

/** Where the served set comes from: the command line, or discovery. */
export type Selection = { kind: "files"; paths: readonly string[] } | { kind: "discovered" };

export interface SessionOptions {
  cwd: string;
  selection: Selection;
  /** Chrome language override (`--lang`). */
  lang?: "en" | "fr";
  /** `false` skips gh entirely. */
  useGh?: boolean;
  /** Where an unreadable state file and a failed exclude are reported. */
  warn?: (message: string) => void;
}

export interface Session {
  api: Api;
  /** Served walkthroughs, repo-relative. */
  paths: readonly string[];
  /** Diagnostics of the eager compile — warnings, and the soft errors that still serve. */
  outcome: CheckOutcome;
  /** Stops the file watcher. */
  close(): void;
}

export type Prepared =
  /** Ready to serve; `outcome` may still carry warnings and error cards. */
  | { kind: "ready"; session: Session }
  /** Nothing to serve, and the sentence that says why. */
  | { kind: "note"; message: string }
  /** A dead repository, PR or file: `open` prints this and stops. */
  | { kind: "failed"; outcome: CheckOutcome };

const NOT_A_REPO =
  "Not inside a git repository — run balade from the repository that holds the walkthrough.";

type Selected =
  | { kind: "ok"; root: string; paths: readonly string[] }
  | { kind: "note"; message: string };

/** Named files are made repo-relative; discovery already answers in that shape. */
function select(options: SessionOptions): Selected {
  if (options.selection.kind === "discovered") {
    const found = discoverWalkthroughs(options.cwd);
    if (found.repoRoot === null) return { kind: "note", message: NOT_A_REPO };
    if (found.paths.length === 0) return { kind: "note", message: NO_WALKTHROUGH };
    return { kind: "ok", root: found.repoRoot, paths: found.paths };
  }

  const root = gitOut(["rev-parse", "--show-toplevel"], options.cwd)?.trim();
  if (root === undefined || root === "") return { kind: "note", message: NOT_A_REPO };
  const paths = options.selection.paths.map((path) => toRepoRelative(root, options.cwd, path));
  return paths.length === 0
    ? { kind: "note", message: NO_WALKTHROUGH }
    : { kind: "ok", root, paths };
}

export function prepareSession(options: SessionOptions): Prepared {
  const warn = options.warn ?? ((message: string) => process.stderr.write(`${message}\n`));

  const selected = select(options);
  if (selected.kind === "note") return selected;
  const { root, paths } = selected;

  const repo: ServerRepo = serverRepo({
    root,
    ...(options.lang !== undefined ? { lang: options.lang } : {}),
    ...(options.useGh !== undefined ? { useGh: options.useGh } : {}),
  });
  const payloads = payloadCache(repo);

  /* Named files compile before the port opens, so a dead repository, PR or path
     stops the command instead of greeting the reviewer with a blank app.
     Discovery serves an index, which needs frontmatter only. */
  const outcome =
    options.selection.kind === "files"
      ? compileEagerly(payloads, paths)
      : { ok: true, reports: [] };
  if (!outcome.ok) return { kind: "failed", outcome };

  const api = createApi({
    paths,
    payloads,
    state: fileReviewStore({ repoRoot: root, warn }),
    repo,
  });

  return {
    kind: "ready",
    session: {
      api,
      paths,
      outcome,
      close: watchWalkthroughs({ root, paths, cache: payloads, warn }),
    },
  };
}

/**
 * A payload is dead when the compiler could not build one at all — no
 * repository, no PR, no file. An unresolvable range is not: it rides along as
 * an in-app error card (#15, soft `open`).
 */
function compileEagerly(payloads: PayloadCache, paths: readonly string[]): CheckOutcome {
  const reports = paths.map((path) => {
    const loaded = payloads.get(path);
    return {
      file: loaded.sourcePath,
      ok: loaded.payload !== null,
      diagnostics: loaded.diagnostics,
      ranges: loaded.ranges,
    };
  });
  return { ok: reports.every((report) => report.ok), reports };
}

/**
 * Directories, not files: an editor that saves through a rename replaces the
 * inode a file watcher holds, and the change is then never seen.
 */
function watchWalkthroughs(options: {
  root: string;
  paths: readonly string[];
  cache: PayloadCache;
  warn: (message: string) => void;
}): () => void {
  const watchers: FSWatcher[] = [];
  const byDirectory = new Map<string, string[]>();
  for (const path of options.paths) {
    const directory = dirname(path);
    byDirectory.set(directory, [...(byDirectory.get(directory) ?? []), path]);
  }

  /* A watcher that never starts costs freshness, not correctness: the payloads
     stay as they were compiled until the CLI restarts, so it is said out loud. */
  const lost = (directory: string, reason: unknown): void => {
    options.warn(
      `balade: no file watcher on ${directory} (${reason instanceof Error ? reason.message : String(reason)}). ` +
        "Restart balade to pick up edits to the walkthrough.",
    );
  };

  for (const [directory, served] of byDirectory) {
    try {
      const watcher = watch(join(options.root, directory), (_event, filename) => {
        if (filename === null) {
          for (const path of served) options.cache.invalidate(path);
          return;
        }
        const name = String(filename);
        options.cache.invalidate(directory === "." ? name : `${directory}/${name}`);
      });
      watcher.on("error", (error) => {
        watcher.close();
        lost(directory, error);
      });
      watchers.push(watcher);
    } catch (error) {
      lost(directory, error);
    }
  }

  return () => {
    for (const watcher of watchers) watcher.close();
  };
}

/* `git rev-parse` answers the real path; a symlinked directory — /var on macOS,
   for one — would otherwise turn the relative path into a climb out of the repo. */
function toRepoRelative(root: string, cwd: string, path: string): string {
  const absolute = isAbsolute(path) ? path : resolvePath(cwd, path);
  return relative(real(root), real(absolute));
}

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
