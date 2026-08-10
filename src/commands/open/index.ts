/** `balade open`: read flags, locate the target, own the live review session. */

import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { parseOpenTarget } from "../../git/pr.js";
import { locateErrorMessage, PrLocator } from "./locator.js";
import { runReviewSession } from "../../server/review.js";
import { stopMessage } from "../../terminal.js";

const langFlag = Flag.choice("lang", ["en", "fr"]).pipe(
  Flag.withDescription("Chrome language; overrides meta.lang"),
  Flag.optional,
);

const portFlag = Flag.integer("port").pipe(
  Flag.withDescription("Port to listen on; 0 asks the system for a free one"),
  Flag.withDefault(0),
);

const noBrowserFlag = Flag.boolean("no-browser").pipe(
  Flag.withDescription("Serve headless: print the URL without opening a browser"),
);

const openTargets = Argument.variadic(
  Argument.string("target").pipe(
    Argument.withDescription(
      "Walkthrough file, bare PR number, URL, or quoted '#number'; omit to use every discovered walkthrough",
    ),
  ),
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
      return yield* runReviewSession({
        session: {
          cwd: process.cwd(),
          selection,
          ...(Option.isSome(config.lang) ? { lang: config.lang.value } : {}),
        },
        port: config.port,
        browserMode: config.noBrowser ? "headless" : "launch",
      });
    }).pipe(
      Effect.catch((error) => Effect.sync(() => stopMessage(locateErrorMessage(error)))),
      Effect.scoped,
    ),
).pipe(Command.withDescription("Serve a live review session and open it in your default browser"));
