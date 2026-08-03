/** Browser capabilities supplied to the app's Effect layers. */

import { Context, Layer } from "effect";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class BrowserStorage extends Context.Service<BrowserStorage, StorageLike>()(
  "@balade/app/BrowserStorage",
) {}

export class BrowserFetch extends Context.Service<BrowserFetch, FetchLike>()(
  "@balade/app/BrowserFetch",
) {}

export const storageLayer = (storage: StorageLike) => Layer.succeed(BrowserStorage, storage);

export const fetchLayer = (fetch: FetchLike) => Layer.succeed(BrowserFetch, fetch);

/* Read globals only when a capability is used. The renderer may be imported by
   server-rendering tests where no browser exists. */
const liveStorage: StorageLike = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => {
    window.localStorage.setItem(key, value);
  },
};

const liveFetch: FetchLike = (url, init) => window.fetch(url, init);

const liveStorageLayer = storageLayer(liveStorage);
const liveFetchLayer = fetchLayer(liveFetch);

export const browserLayer = Layer.merge(liveStorageLayer, liveFetchLayer);
