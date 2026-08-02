/* Review-state persistence behind one interface: the served endpoint when a CLI
   is listening, localStorage under `Payload.storageKey` in the static export —
   and localStorage again whenever the endpoint refuses. */

import { parseReviewJson, parseReviewState } from "../../../src/payload/parse-review";
import { Effect } from "effect";
import type { Payload, ReviewState } from "../contract";

/** What a save reached: `"fallback"` means the endpoint refused and the browser copy took it. */
export type SaveOutcome = "saved" | "fallback" | "failed";

export interface ReviewStore {
  load(): Promise<ReviewState | null>;
  save(state: ReviewState): Promise<SaveOutcome>;
}

/** The browser seams a store touches, as parameters so a test supplies its own. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type StoreWarning = (message: string, error?: unknown) => void;

const browserWarning: StoreWarning = (message, error) => console.warn(message, error);

export function localStore(
  storageKey: string,
  storage: StorageLike,
  warn: StoreWarning = browserWarning,
): ReviewStore {
  return {
    async load() {
      let raw: string | null;
      try {
        raw = storage.getItem(storageKey);
      } catch (error) {
        warn(`balade: could not read browser review state for ${storageKey}.`, error);
        return null;
      }
      if (raw === null) return null;
      try {
        return await Effect.runPromise(parseReviewJson(raw));
      } catch (error) {
        warn(`balade: ignoring invalid browser review state for ${storageKey}.`, error);
        return null;
      }
    },
    async save(state) {
      try {
        storage.setItem(storageKey, JSON.stringify(state));
        return "saved";
      } catch (error) {
        /* private mode or a full quota: the marks stay in memory for this visit */
        warn(`balade: could not save browser review state for ${storageKey}.`, error);
        return "failed";
      }
    },
  };
}

export function httpStore(
  path: string,
  fallback: ReviewStore,
  fetch: FetchLike,
  warn: StoreWarning = browserWarning,
): ReviewStore {
  const url = `/api/state?path=${encodeURIComponent(path)}`;
  return {
    async load() {
      try {
        const response = await fetch(url, { headers: { accept: "application/json" } });
        /* 404 means the CLI holds nothing — not that nothing exists: marks made
           while it was down live on in the browser copy. */
        if (!response.ok) {
          if (response.status !== 404)
            warn(`balade: review-state GET failed (${response.status}).`);
          return fallback.load();
        }
        const body: unknown = await response.json();
        try {
          return await Effect.runPromise(parseReviewState(body));
        } catch (error) {
          warn("balade: the served review state was invalid; using the browser copy.", error);
          return fallback.load();
        }
      } catch (error) {
        warn("balade: could not load served review state; using the browser copy.", error);
        return fallback.load();
      }
    },
    async save(state) {
      try {
        const response = await fetch(url, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(state),
        });
        if (response.ok) return "saved";
        warn(`balade: review-state PUT failed (${response.status}); using the browser copy.`);
      } catch (error) {
        /* the CLI stopped listening; the browser copy is the last resort */
        warn("balade: could not save served review state; using the browser copy.", error);
      }
      return (await fallback.save(state)) === "saved" ? "fallback" : "failed";
    },
  };
}

export interface StoreOptions {
  /** `"served"` writes through the CLI endpoint; `"export"` is localStorage only. */
  mode: "served" | "export";
}

/* The globals are read when a store is used, never at construction: the route
   builds one during server rendering too, where no browser exists. */
const browserStorage: StorageLike = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => {
    window.localStorage.setItem(key, value);
  },
};

const browserFetch: FetchLike = (url, init) => window.fetch(url, init);

export const storeFor = (payload: Payload, options: StoreOptions): ReviewStore => {
  const local = localStore(payload.storageKey, browserStorage);
  return options.mode === "served" ? httpStore(payload.sourcePath, local, browserFetch) : local;
};
