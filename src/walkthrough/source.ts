/** Walkthrough file IO shared by document and clarification compilation. */
import { Effect, FileSystem, Schema } from "effect";

export class WalkthroughFileReadFailed extends Schema.TaggedErrorClass<WalkthroughFileReadFailed>()(
  "WalkthroughFileReadFailed",
  { path: Schema.String, cause: Schema.Defect() },
) {}

export const readWalkthrough = Effect.fn("readWalkthrough")(function* (
  absolute: string,
  file: string,
) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs
    .readFileString(absolute)
    .pipe(Effect.mapError((cause) => new WalkthroughFileReadFailed({ path: file, cause })));
});
