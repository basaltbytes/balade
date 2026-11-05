/** `balade open`: read flags, locate the target, own the live review session. */

import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { parseOpenTarget } from "../../git/pr.js";
import { locateErrorMessage, PrLocator } from "./locator.js";
import { runReviewSession } from "../../server/review.js";
import type { SessionOptions } from "../../server/session.js";
import { stopMessage } from "../../terminal.js";

const langFlag = Flag.Literals("lang", ["en", "fr"]).pipe(
  Flag.withDescription("Chrome language; overrides meta.lang"),
  Flag.optional,
);

const portFlag = Flag.Int("port").pipe(
  Flag.withDescription("Port to listen on; 0 asks the system for a free one"),
  Flag.withDefault(0),
);

const noBrowserFlag = Flag.Boolean("no-browser").pipe(
  Flag.withDefault(false),
  Flag.withDescription("Serve headless: print the URL without opening a browser"),
);

const openTargets = Argument.String("target").pipe(
  Argument.withDescription(
    "Walkthrough file, bare PR number, URL, or quoted '#number'; omit to use every discovered walkthrough",
  ),
  Argument.variadic(),
);

export const openCommand = Command.make(
  "open",
  { files: openTargets, lang: langFlag, port: portFlag, noBrowser: noBrowserFlag },
  (config) =>
    Effect.gen(function* () {
      const target = parseOpenTarget(config.files);
      if (target.kind === "invalid") {
        stopMessage(target.message);
        return;
      }
      const selection =
        target.kind === "pr"
          ? yield* PrLocator.use((locator) => locator.locate(process.cwd(), target.pr))
          : target;
      const session: SessionOptions = { cwd: process.cwd(), selection };
      if (Option.isSome(config.lang)) session.lang = config.lang.value;
      return yield* runReviewSession({
        session,
        port: config.port,
        browserMode: config.noBrowser ? "headless" : "launch",
      });
    }).pipe(
      Effect.catch((error) => Effect.sync(() => stopMessage(locateErrorMessage(error)))),
      Effect.scoped,
    ),
).pipe(Command.withDescription("Serve a live review session and open it in your default browser"));
