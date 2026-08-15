/** Strict browser boundary for the served clarification API. */

import { Effect, Schema } from "effect";
import { QaState as QaStateSchema } from "../../../src/contract/schema";
import type { QaAskRequest, QaState } from "../contract";
import { BrowserFetch } from "./browser";

const decodeQaState = Schema.decodeUnknownEffect(QaStateSchema, {
  onExcessProperty: "error",
});

export class QaFetchFailed extends Schema.TaggedErrorClass<QaFetchFailed>()("QaFetchFailed", {
  cause: Schema.Defect(),
}) {}

export class QaResponseInvalid extends Schema.TaggedErrorClass<QaResponseInvalid>()(
  "QaResponseInvalid",
  { cause: Schema.Defect() },
) {}

export type QaApiError = QaFetchFailed | QaResponseInvalid;

export const fetchQa = Effect.fn("App.fetchQa")(function* (sourcePath: string) {
  return yield* requestQa(`/api/qa?path=${encodeURIComponent(sourcePath)}`, { method: "GET" });
});

export const askQa = Effect.fn("App.askQa")(function* (sourcePath: string, request: QaAskRequest) {
  return yield* requestQa(`/api/qa?path=${encodeURIComponent(sourcePath)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
});

const requestQa = Effect.fn("App.requestQa")(function* (url: string, init: RequestInit) {
  const fetch = yield* BrowserFetch;
  const response = yield* Effect.tryPromise({
    try: (signal) => fetch(url, { ...init, signal }),
    catch: (cause) => new QaFetchFailed({ cause }),
  });
  if (!response.ok) {
    return yield* new QaFetchFailed({
      cause: { status: response.status, statusText: response.statusText },
    });
  }
  const body: unknown = yield* Effect.tryPromise({
    try: () => response.json(),
    catch: (cause) => new QaResponseInvalid({ cause }),
  });
  return yield* decodeQaState(body).pipe(
    Effect.mapError((cause) => new QaResponseInvalid({ cause })),
  );
});

export type { QaState };
