import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { Payload as PayloadSchema } from "../../../src/contract/schema";
import { pr96 } from "./pr96";

it.effect("keeps the representative PR fixture inside the payload contract", () =>
  Schema.decodeUnknownEffect(PayloadSchema, { onExcessProperty: "error" })(pr96).pipe(
    Effect.map((payload) => expect(payload).toEqual(pr96)),
  ),
);
