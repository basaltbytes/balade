/** `balade open`: read flags, locate the target, own the live review session. */

import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { parseOpenTarget } from "../../git/pr.js";
import { locateErrorMessage, PrLocator } from "./locator.js";
import { runReviewSession } from "../../server/review.js";
import type { Selection } from "../../server/session.js";
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
      "Walkthrough file or pull request (URL, #number); omit to use every discovered walkthrough",
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
      let selection: Option.Option<Selection>;
      if (target.kind === "pr") {
        const locator = yield* PrLocator;
        selection = yield* locator.locate(process.cwd(), target.pr).pipe(
          Effect.map(Option.some),
          Effect.catch((error) =>
            Effect.sync(() => {
              stopMessage(locateErrorMessage(error));
              return Option.none<Selection>();
            }),
          ),
        );
      } else {
        selection = Option.some<Selection>(target);
      }
      if (Option.isNone(selection)) return;
      return yield* runReviewSession({
        session: {
          cwd: process.cwd(),
          selection: selection.value,
          ...(Option.isSome(config.lang) ? { lang: config.lang.value } : {}),
        },
        port: config.port,
        browserMode: config.noBrowser ? "headless" : "launch",
      });
    }).pipe(Effect.scoped),
).pipe(Command.withDescription("Serve a live review session and open it in your default browser"));
