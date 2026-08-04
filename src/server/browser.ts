/**
 * Browser launch for served mode. The platform mapping is a pure function; the
 * detached spawn sits behind a service seam, so tests run real fixture
 * commands and the suite never opens a browser.
 */

import { spawn } from "node:child_process";
import { Context, Effect, Layer, Schema } from "effect";

export class BrowserLaunchFailed extends Schema.TaggedErrorClass<BrowserLaunchFailed>()(
  "BrowserLaunchFailed",
  { url: Schema.String, reason: Schema.String },
) {}

/** How a review session reaches the reviewer: in the default browser, or URL only. */
export type BrowserMode = "launch" | "headless";

export interface BrowserCommand {
  readonly file: string;
  readonly args: readonly string[];
}

/** The platform's URL opener; every argument except the URL is fixed. */
export const browserCommand = (platform: NodeJS.Platform, url: string): BrowserCommand => {
  switch (platform) {
    case "darwin":
      return { file: "open", args: [url] };
    case "win32":
      /* `start` is a cmd built-in; the empty argument is the window title. */
      return { file: "cmd", args: ["/c", "start", "", url] };
    default:
      return { file: "xdg-open", args: [url] };
  }
};

/* A fast exit is a verdict — missing binary, no display, no handler. An opener
   still running past this window is attached to the browser it started (some
   Linux handlers stay in the foreground) and counts as launched. */
const EXIT_VERDICT_WINDOW_MILLIS = 2000;

export interface BrowserLauncherShape {
  readonly launch: (url: string) => Effect.Effect<void, BrowserLaunchFailed>;
}

/** The one process port for reaching the default browser. */
export class BrowserLauncher extends Context.Service<BrowserLauncher, BrowserLauncherShape>()(
  "@balade/BrowserLauncher",
) {
  /** Tests inject the opener command and shorten the verdict window. */
  static readonly layerWith = (command: (url: string) => BrowserCommand, windowMillis: number) =>
    Layer.sync(BrowserLauncher, () => ({
      launch: Effect.fn("BrowserLauncher.launch")(function* (url: string) {
        return yield* launchDetached(command(url), url, windowMillis);
      }),
    }));

  static readonly layer = BrowserLauncher.layerWith(
    (url) => browserCommand(process.platform, url),
    EXIT_VERDICT_WINDOW_MILLIS,
  );
}

/** `--no-browser` keeps a session headless: the URL is printed, never opened. */
export const launchBrowser = (
  mode: BrowserMode,
  url: string,
): Effect.Effect<void, BrowserLaunchFailed, BrowserLauncher> =>
  mode === "headless" ? Effect.void : BrowserLauncher.use((launcher) => launcher.launch(url));

const launchDetached = (command: BrowserCommand, url: string, windowMillis: number) =>
  Effect.callback<void, BrowserLaunchFailed>((resume) => {
    /* `windowsHide` keeps `cmd /c start` from flashing a console window. */
    const child = spawn(command.file, [...command.args], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      child.unref();
      resume(Effect.void);
    }, windowMillis);
    child.once("error", (error) => {
      clearTimeout(timer);
      resume(Effect.fail(new BrowserLaunchFailed({ url, reason: error.message })));
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resume(
        code === 0
          ? Effect.void
          : Effect.fail(
              new BrowserLaunchFailed({
                url,
                reason:
                  signal === null
                    ? `${command.file} exited with code ${code ?? "unknown"}`
                    : `${command.file} ended by signal ${signal}`,
              }),
            ),
      );
    });
    /* Interruption leaves the opener running detached; the browser is not ours to close. */
    return Effect.sync(() => {
      clearTimeout(timer);
      child.unref();
    });
  });
