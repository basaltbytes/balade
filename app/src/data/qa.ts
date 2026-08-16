/** Strict browser boundary for the served clarification API. */

import { Effect, Schema } from "effect";
import { parseQaAgentStatus, parseQaState } from "../../../src/contract/qa-parser";
import type { QaAgentStatus, QaAskRequest, QaState } from "../contract";
import { BrowserFetch } from "./browser";

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

export const fetchQaAgentStatus = Effect.fn("App.fetchQaAgentStatus")(function* () {
  const body = yield* requestJson("/api/agent", { method: "GET" });
  return yield* parseQaAgentStatus(body).pipe(
    Effect.mapError((cause) => new QaResponseInvalid({ cause })),
  );
});

export const askQa = Effect.fn("App.askQa")(function* (sourcePath: string, request: QaAskRequest) {
  return yield* requestQa(`/api/qa?path=${encodeURIComponent(sourcePath)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
});

const requestQa = Effect.fn("App.requestQa")(function* (url: string, init: RequestInit) {
  const body = yield* requestJson(url, init);
  return yield* parseQaState(body).pipe(
    Effect.mapError((cause) => new QaResponseInvalid({ cause })),
  );
});

const requestJson = Effect.fn("App.requestQaJson")(function* (url: string, init: RequestInit) {
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
  return yield* Effect.tryPromise({
    try: () => response.json(),
    catch: (cause) => new QaResponseInvalid({ cause }),
  });
});

export type { QaAgentStatus, QaState };
