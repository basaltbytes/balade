/**
 * Browser launch through the real process seam: fixture commands stand in for
 * the platform opener, so the suite proves launch, headless mode, and failure
 * without ever opening a browser.
 *
 * The suite runs on loaded machines where a Node fixture can take seconds to
 * start, so verdict windows are generous and the launch marker is polled, not
 * read at a fixed instant.
 */

import { Effect } from "effect";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "@effect/vitest";
import {
  BrowserLauncher,
  browserCommand,
  launchBrowser,
  type BrowserCommand,
} from "../src/server/browser.js";

const URL = "http://127.0.0.1:4173/";
const WINDOW_MILLIS = 15_000;
const TEST_MILLIS = 30_000;

describe("browserCommand", () => {
  it("maps each platform to its opener, URL last", () => {
    expect(browserCommand("darwin", URL)).toEqual({ file: "open", args: [URL] });
    expect(browserCommand("win32", URL)).toEqual({ file: "cmd", args: ["/c", "start", "", URL] });
    expect(browserCommand("linux", URL)).toEqual({ file: "xdg-open", args: [URL] });
    expect(browserCommand("freebsd", URL)).toEqual({ file: "xdg-open", args: [URL] });
  });
});

describe("BrowserLauncher", () => {
  const dir = mkdtempSync(join(tmpdir(), "balade-browser-"));
  const marker = join(dir, "opened.txt");

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** A real opener process that records the URL it was asked to open. */
  const recording = (url: string): BrowserCommand => ({
    file: process.execPath,
    args: ["-e", "require('node:fs').writeFileSync(process.argv[1], process.argv[2])", marker, url],
  });

  /** Real-timer poll: the opener writes on its own schedule, not the test's. */
  const awaitMarker = Effect.promise(
    () =>
      new Promise<string>((resolve, reject) => {
        const startedAt = Date.now();
        const poll = () => {
          if (existsSync(marker)) return resolve(readFileSync(marker, "utf8"));
          if (Date.now() - startedAt > WINDOW_MILLIS) {
            return reject(new Error("the opener never recorded a launch"));
          }
          setTimeout(poll, 25);
        };
        poll();
      }),
  );

  it.effect(
    "launches the opener with the session URL",
    () =>
      Effect.gen(function* () {
        rmSync(marker, { force: true });
        yield* launchBrowser("launch", URL);
        expect(yield* awaitMarker).toBe(URL);
      }).pipe(Effect.provide(BrowserLauncher.layerWith(recording, WINDOW_MILLIS))),
    TEST_MILLIS,
  );

  it.effect("headless mode never spawns the opener", () =>
    Effect.gen(function* () {
      rmSync(marker, { force: true });
      yield* launchBrowser("headless", URL);
      expect(existsSync(marker)).toBe(false);
    }).pipe(Effect.provide(BrowserLauncher.layerWith(recording, WINDOW_MILLIS))),
  );

  it.effect(
    "a fast non-zero exit is a typed launch failure",
    () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(launchBrowser("launch", URL));
        expect(error._tag).toBe("BrowserLaunchFailed");
        expect(error.url).toBe(URL);
        expect(error.reason).toContain("exited with code 3");
      }).pipe(
        Effect.provide(
          BrowserLauncher.layerWith(
            () => ({ file: process.execPath, args: ["-e", "process.exit(3)"] }),
            WINDOW_MILLIS,
          ),
        ),
      ),
    TEST_MILLIS,
  );

  it.effect(
    "a missing opener binary is a typed launch failure",
    () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(launchBrowser("launch", URL));
        expect(error._tag).toBe("BrowserLaunchFailed");
        expect(error.reason).not.toBe("");
      }).pipe(
        Effect.provide(
          BrowserLauncher.layerWith(
            () => ({ file: "balade-no-such-opener", args: [URL] }),
            WINDOW_MILLIS,
          ),
        ),
      ),
    TEST_MILLIS,
  );

  /* The fixture outlives the verdict window, like xdg-open running a browser in
     the foreground; launch settles as started and leaves it detached. The
     window is real but short: this path never involves fixture startup time. */
  it.effect(
    "an opener that stays attached to the browser counts as launched",
    () =>
      launchBrowser("launch", URL).pipe(
        Effect.provide(
          BrowserLauncher.layerWith(
            () => ({ file: process.execPath, args: ["-e", "setTimeout(() => {}, 5000)"] }),
            250,
          ),
        ),
      ),
    TEST_MILLIS,
  );
});
