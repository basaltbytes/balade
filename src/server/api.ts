/**
 * What the four served endpoints answer, as plain values. HTTP lives one
 * module up in `serve.ts`; everything here is a function of the ports it is
 * given, so a test drives it without a socket.
 *
 * `?path=` is untrusted input: it names a walkthrough this run serves or it
 * names nothing at all — which is also what keeps the parameter from reaching
 * the file system.
 */

import { parseReviewState } from "../payload/parse-review.js";
import type { CheckDiagnostic, IndexEntry, IndexPayload } from "../payload/types.js";
import type { ReviewStateStore } from "../state/store.js";
import type { PayloadCache } from "./cache.js";
import type { IndexRow } from "./repo.js";

/** One endpoint's answer: a JSON body, or a status with a sentence for it. */
export type Answer =
  | { kind: "json"; body: unknown }
  | { kind: "error"; status: 400 | 404 | 500; message: string };

/** The slice of the repository adapter the answers read. */
export interface ApiRepo {
  readonly slug: string;
  pin(sourcePath: string): string | null;
  distance(pin: string): number | null;
  row(sourcePath: string): IndexRow | null;
}

export interface ApiPorts {
  /** Served walkthroughs, repo-relative. More than one puts the index on the bare endpoint. */
  paths: readonly string[];
  payloads: PayloadCache;
  state: ReviewStateStore;
  repo: ApiRepo;
}

export interface Api {
  /** `GET /api/walkthrough` — one payload, or the index when several are served. */
  walkthrough(path: string | null): Answer;
  /** `GET /api/state` — the marks on disk, 404 when the CLI holds none. */
  readState(path: string | null): Answer;
  /** `PUT /api/state` — the body is unknown until it parses. */
  writeState(path: string | null, body: unknown): Answer;
  /** `GET /api/staleness` — how far the head moved past the stamp. */
  staleness(path: string | null): Answer;
}

/** What `?path=` resolved to. `index` means "no path given, and several served". */
type Target = { kind: "one"; path: string } | { kind: "index" } | { kind: "unknown" };

const NEEDS_PATH = "This run serves several walkthroughs; name one with `?path=`.";

export function createApi(ports: ApiPorts): Api {
  const served = new Set(ports.paths);
  const only = ports.paths.length === 1 ? ports.paths[0] : undefined;

  const targetOf = (path: string | null): Target => {
    if (path === null) return only === undefined ? { kind: "index" } : { kind: "one", path: only };
    return served.has(path) ? { kind: "one", path } : { kind: "unknown" };
  };

  const notServed = (path: string | null): Answer => ({
    kind: "error",
    status: 404,
    message: `This run does not serve \`${path ?? ""}\`.`,
  });

  /** The three per-file endpoints all need one walkthrough, never the index. */
  const oneOf = (path: string | null): { kind: "one"; path: string } | Answer => {
    const target = targetOf(path);
    if (target.kind === "one") return target;
    if (target.kind === "index") return { kind: "error", status: 400, message: NEEDS_PATH };
    return notServed(path);
  };

  return {
    walkthrough(path) {
      const target = targetOf(path);
      if (target.kind === "unknown") return notServed(path);
      if (target.kind === "index") return { kind: "json", body: buildIndex(ports) };

      const loaded = ports.payloads.get(target.path);
      if (loaded.payload === null) {
        return { kind: "error", status: 500, message: firstFailure(loaded.diagnostics) };
      }
      return { kind: "json", body: loaded.payload };
    },

    readState(path) {
      const target = oneOf(path);
      if (target.kind !== "one") return target;

      const stored = ports.state.read(target.path);
      if (stored === null) {
        return {
          kind: "error",
          status: 404,
          message: `No review state for \`${target.path}\` yet.`,
        };
      }
      return { kind: "json", body: stored };
    },

    writeState(path, body) {
      const target = oneOf(path);
      if (target.kind !== "one") return target;

      const state = parseReviewState(body);
      if (state === null) {
        return {
          kind: "error",
          status: 400,
          message: "The body is not a review state: it needs version 1, walkthrough, pr and stamp.",
        };
      }
      if (state.walkthrough !== target.path) {
        return {
          kind: "error",
          status: 400,
          message: `The body names \`${state.walkthrough}\`, but the request names \`${target.path}\`.`,
        };
      }
      ports.state.write(target.path, state);
      return { kind: "json", body: state };
    },

    staleness(path) {
      const target = oneOf(path);
      if (target.kind !== "one") return target;

      const pin = ports.repo.pin(target.path);
      if (pin === null) {
        return {
          kind: "error",
          status: 404,
          message: `\`${target.path}\` carries no readable stamp.`,
        };
      }
      const headDistance = ports.repo.distance(pin);
      if (headDistance === null) {
        return {
          kind: "error",
          status: 404,
          message: `The stamp \`${pin}\` is not in this clone.`,
        };
      }
      return { kind: "json", body: { headDistance } };
    },
  };
}

/**
 * The index reads frontmatter, `git log -1` and the local state files (#21) —
 * never a resolve, so a repository of twenty walkthroughs still answers at once.
 * Progress counts the marks that are on disk; the walkthrough itself applies the
 * hash rule when it opens.
 */
function buildIndex(ports: ApiPorts): IndexPayload {
  const entries: IndexEntry[] = [];
  for (const path of ports.paths) {
    const row = ports.repo.row(path);
    if (row === null) continue;

    const stored = ports.state.read(path);
    const done =
      stored === null ? null : Math.min(Object.keys(stored.sections).length, row.sections);
    entries.push({
      path,
      title: row.title,
      pr: row.pr,
      meta: row.meta,
      updatedAt: row.updatedAt,
      ...(done === null ? {} : { progress: { done, total: row.sections } }),
    });
  }
  return { kind: "index", repo: ports.repo.slug, entries };
}

function firstFailure(diagnostics: readonly CheckDiagnostic[]): string {
  const failure = diagnostics.find((diagnostic) => diagnostic.level === "error");
  return failure === undefined
    ? "The walkthrough no longer compiles."
    : `${failure.code}: ${failure.message}`;
}
