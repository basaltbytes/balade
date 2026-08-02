/* Where the payload comes from, in order: the baked global of a static export,
   then the served endpoint, then — only under `vite dev` — the pr-96 fixture. */

import type { IndexPayload, Payload } from "../contract";

declare global {
  interface Window {
    /** Baked by the static export; unknown until `parsePayload` has read it. */
    __BALADE__?: unknown;
  }
}

export type Loaded =
  | { kind: "walkthrough"; payload: Payload; served: boolean }
  | { kind: "index"; payload: IndexPayload };

export interface RouteLocation {
  search: string;
  hash: string;
  pathname: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isIndex = (value: Record<string, unknown>): value is Record<string, unknown> & IndexPayload =>
  value["kind"] === "index" && Array.isArray(value["entries"]);

const isWalkthrough = (
  value: Record<string, unknown>,
): value is Record<string, unknown> & Payload =>
  value["walkthrough"] === 1 &&
  Array.isArray(value["sections"]) &&
  Array.isArray(value["files"]) &&
  Array.isArray(value["nav"]) &&
  isRecord(value["pr"]) &&
  typeof value["storageKey"] === "string";

/**
 * The baked global and every CLI answer are edges: nothing becomes a `Payload`
 * without passing here. The block trees are checked as arrays, not walked — a
 * node kind the renderer does not know already draws a labeled placeholder.
 */
export function parsePayload(value: unknown): Payload | IndexPayload | null {
  if (!isRecord(value)) return null;
  if (isIndex(value)) return value;
  if (isWalkthrough(value)) return value;
  return null;
}

/** The walkthrough the location names, through `?path=`, `#/<path>` or `/w/<path>`. */
function walkthroughPath(loc: RouteLocation): string | null {
  const query = new URLSearchParams(loc.search).get("path");
  if (query) return query;
  if (loc.hash.startsWith("#/")) {
    const rest = loc.hash.slice(2);
    if (rest.length > 0) return decodeURIComponent(rest);
  }
  const fromPath = /^\/w\/(.+)$/.exec(loc.pathname);
  if (fromPath?.[1] !== undefined) return decodeURIComponent(fromPath[1]);
  return null;
}

export const hrefFor = (path: string): string => `?path=${encodeURIComponent(path)}`;

const wrap = (data: Payload | IndexPayload, served: boolean): Loaded =>
  "kind" in data
    ? { kind: "index", payload: data }
    : { kind: "walkthrough", payload: data, served };

/** `unreadable` is the chrome sentence a parse failure shows; the caller owns the language. */
export async function loadPayload(loc: RouteLocation, unreadable: string): Promise<Loaded> {
  const raw = window.__BALADE__;
  if (raw !== undefined && raw !== null) {
    const baked = parsePayload(raw);
    if (baked === null) throw new Error(unreadable);
    return wrap(baked, false);
  }

  const path = walkthroughPath(loc);
  const url =
    path === null ? "/api/walkthrough" : `/api/walkthrough?path=${encodeURIComponent(path)}`;
  let failure = "";
  try {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (response.ok) {
      const served = parsePayload(await response.json());
      if (served !== null) return wrap(served, true);
      failure = unreadable;
    } else failure = `${response.status} ${response.statusText}`;
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  if (import.meta.env.DEV) {
    const { pr96 } = await import("../fixtures/pr96");
    return { kind: "walkthrough", payload: pr96, served: false };
  }
  throw new Error(failure);
}

/**
 * The index's staleness badge is one call per row, fired after the page shows.
 * A CLI that does not answer simply leaves the badge off.
 */
export async function fetchHeadDistance(path: string): Promise<number | null> {
  try {
    const response = await fetch(`/api/staleness?path=${encodeURIComponent(path)}`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { headDistance?: unknown };
    return typeof body.headDistance === "number" ? body.headDistance : null;
  } catch {
    return null;
  }
}
