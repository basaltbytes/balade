/**
 * The Q&A sidecar and request gate, shared by the CLI server and SPA.
 *
 * Both values cross untrusted JSON edges. This module stays pure so the app
 * can import the exact same strict decoders as the server.
 */

import { Effect, Schema } from "effect";
import { QaAskRequest as QaAskRequestSchema, QaState as QaStateSchema } from "./schema.js";

const decodeQaState = Schema.decodeUnknownEffect(QaStateSchema, {
  onExcessProperty: "error",
});
const decodeQaAskRequest = Schema.decodeUnknownEffect(QaAskRequestSchema, {
  onExcessProperty: "error",
});

export class QaJsonInvalid extends Schema.TaggedErrorClass<QaJsonInvalid>()("QaJsonInvalid", {
  cause: Schema.Defect(),
}) {}

export class QaStateInvalid extends Schema.TaggedErrorClass<QaStateInvalid>()("QaStateInvalid", {
  cause: Schema.Defect(),
}) {}

export class QaAskRequestInvalid extends Schema.TaggedErrorClass<QaAskRequestInvalid>()(
  "QaAskRequestInvalid",
  { cause: Schema.Defect() },
) {}

export type QaParseError = QaJsonInvalid | QaStateInvalid;

const parseJson = Effect.fn("parseQaJsonValue")(function* (raw: string) {
  return yield* Effect.try({
    /* SAFETY: JSON.parse returns `any`; the assertion only forgets it down to `unknown`. */
    try: () => JSON.parse(raw) as unknown,
    catch: (cause) => new QaJsonInvalid({ cause }),
  });
});

/** A serialized sidecar from disk or HTTP, parsed without discarding its failure reason. */
export const parseQaJson = Effect.fn("parseQaJson")(function* (raw: string) {
  return yield* parseQaState(yield* parseJson(raw));
});

/** A serialized POST body, parsed independently from persisted sidecar state. */
export const parseQaAskJson = Effect.fn("parseQaAskJson")(function* (raw: string) {
  const value = yield* parseJson(raw).pipe(
    Effect.mapError((error) => new QaAskRequestInvalid({ cause: error.cause })),
  );
  return yield* decodeQaAskRequest(value).pipe(
    Effect.mapError((cause) => new QaAskRequestInvalid({ cause })),
  );
});

/* Single-argument on purpose: callers cannot override the strict excess-property gate. */
export const parseQaState = (value: Parameters<typeof decodeQaState>[0]) =>
  decodeQaState(value).pipe(Effect.mapError((cause) => new QaStateInvalid({ cause })));
