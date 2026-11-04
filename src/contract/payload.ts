/** Browser-safe payload boundary. No filesystem, Git or CLI runtime. */
import { Effect, Predicate, Schema } from "effect";
import { PAYLOAD_FORMAT, Payload as PayloadSchema } from "./schema.js";
import type { Payload } from "./types.js";

export { PAYLOAD_FORMAT } from "./schema.js";
export type * from "./types.js";

export class PayloadFormatUnsupported extends Schema.TaggedError<PayloadFormatUnsupported>()(
  "PayloadFormatUnsupported",
  { format: Schema.Int },
) {
  override get message(): string {
    return `Unsupported payload format ${this.format}; expected ${PAYLOAD_FORMAT}. Recompile the walkthrough.`;
  }
}

export class PayloadInvalid extends Schema.TaggedError<PayloadInvalid>()("PayloadInvalid", {
  cause: Schema.Defect(),
}) {}

export type PayloadDecodeError = PayloadFormatUnsupported | PayloadInvalid;

const payload: ReturnType<typeof Schema.decodeUnknownEffect<typeof PayloadSchema>> =
  Schema.decodeUnknownEffect(PayloadSchema, { onExcessProperty: "error" });

/** Strict decoding; only the current format is supported. */
export const decodePayload = (
  input: Parameters<typeof payload>[0],
): Effect.Effect<Payload, PayloadDecodeError> => {
  // Inspect only the version before decoding its shape; malformed envelopes
  // still receive the complete schema diagnostic below.
  if (
    Predicate.hasProperty(input, "format") &&
    Predicate.isNumber(input.format) &&
    Number.isSafeInteger(input.format) &&
    input.format !== PAYLOAD_FORMAT
  ) {
    return Effect.fail(new PayloadFormatUnsupported({ format: input.format }));
  }
  return payload(input).pipe(Effect.mapError((cause) => new PayloadInvalid({ cause })));
};
