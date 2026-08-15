/**
 * Herdr presence through the real socket seam: a local server stands in for
 * herdr, so the suite proves the frame dialect, state coalescing, the settled
 * flush at scope close, and that a dead socket never fails a command.
 */

import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import {
  AgentPresence,
  herdrEndpoint,
  herdrPane,
  herdrPresenceLayer,
  reportPresence,
  reportWaitingDuring,
  type HerdrPane,
  type LifecycleState,
} from "../src/presence.js";

const WINDOW_MILLIS = 15_000;
const TEST_MILLIS = 30_000;
const PANE_ID = "w1:p2";

const directories: string[] = [];

afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

/** A pane whose socket lives in a fresh scratch location on every platform. */
function scratchPane(): HerdrPane {
  if (process.platform === "win32") {
    const name = `balade-presence-${process.pid}-${Math.random().toString(36).slice(2)}`;
    return { socketPath: name, paneId: PANE_ID };
  }
  const directory = mkdtempSync(join(tmpdir(), "balade-presence-"));
  directories.push(directory);
  return { socketPath: join(directory, "herdr.sock"), paneId: PANE_ID };
}

interface FrameServer {
  readonly frames: unknown[];
  readonly close: () => void;
}

/** Accepts one JSON line per connection and acknowledges it, as herdr does. */
function startServer(endpoint: string): Promise<FrameServer> {
  return new Promise((resolve, reject) => {
    const frames: unknown[] = [];
    const server = net.createServer((socket) => {
      let pending = "";
      socket.on("data", (chunk) => {
        pending += chunk.toString("utf8");
        const newline = pending.indexOf("\n");
        if (newline === -1) return;
        const frame: unknown = JSON.parse(pending.slice(0, newline));
        frames.push(frame);
        pending = "";
        socket.write('{"ok":true}\n');
      });
      socket.on("error", () => {});
    });
    server.on("error", reject);
    server.listen(endpoint, () => {
      resolve({ frames, close: () => server.close() });
    });
  });
}

/** What herdr's `pane.report_agent` endpoint receives, as the suite checks it. */
const ReportRequest = Schema.Struct({
  method: Schema.String,
  params: Schema.Struct({
    pane_id: Schema.String,
    source: Schema.String,
    agent: Schema.String,
    state: Schema.String,
    seq: Schema.Finite,
  }),
});

const serverFor = (socketPath: string) =>
  Effect.acquireRelease(
    Effect.promise(() => startServer(herdrEndpoint(socketPath))),
    (server) => Effect.sync(() => server.close()),
  );

/** Real-timer poll: reports travel their own sockets, not the test's clock. */
const awaitFrames = (server: FrameServer, count: number) =>
  Effect.promise(
    () =>
      new Promise<void>((resolve, reject) => {
        const startedAt = Date.now();
        const poll = () => {
          if (server.frames.length >= count) return resolve();
          if (Date.now() - startedAt > WINDOW_MILLIS) {
            return reject(new Error(`saw ${server.frames.length} of ${count} reports`));
          }
          setTimeout(poll, 25);
        };
        poll();
      }),
  );

describe("herdrPane", () => {
  const complete = {
    HERDR_ENV: "1",
    HERDR_SOCKET_PATH: "/tmp/herdr.sock",
    HERDR_PANE_ID: PANE_ID,
  };

  it("recognizes a herdr pane only when all three variables are set", () => {
    expect(herdrPane(complete)).toEqual({ socketPath: "/tmp/herdr.sock", paneId: PANE_ID });
    expect(herdrPane({})).toBeUndefined();
    expect(herdrPane({ ...complete, HERDR_ENV: undefined })).toBeUndefined();
    expect(herdrPane({ ...complete, HERDR_ENV: "0" })).toBeUndefined();
    expect(herdrPane({ ...complete, HERDR_SOCKET_PATH: "" })).toBeUndefined();
    expect(herdrPane({ ...complete, HERDR_PANE_ID: "" })).toBeUndefined();
  });
});

describe("herdrPresenceLayer", () => {
  it.effect(
    "reports transitions in herdr's dialect and flushes settled at scope close",
    () =>
      Effect.gen(function* () {
        const pane = scratchPane();
        const server = yield* serverFor(pane.socketPath);

        yield* Effect.gen(function* () {
          yield* reportPresence("working");
          yield* awaitFrames(server, 1);
          /* A repeated state is coalesced or deduplicated, never re-sent. */
          yield* reportPresence("working");
          yield* reportPresence("waiting");
          yield* awaitFrames(server, 2);
        }).pipe(Effect.provide(herdrPresenceLayer(pane)));

        /* The finalizer completes before the layer scope closes. */
        expect(server.frames).toHaveLength(3);
        const decodeReport = Schema.decodeUnknownEffect(ReportRequest);
        const reports = yield* Effect.forEach(server.frames, (frame) => decodeReport(frame));
        for (const report of reports) {
          expect(report.method).toBe("pane.report_agent");
          expect(report.params).toMatchObject({
            pane_id: PANE_ID,
            source: "custom:balade",
            agent: "balade",
          });
        }
        expect(reports.map((report) => report.params.state)).toEqual([
          "working",
          "blocked",
          "idle",
        ]);
        const sequence = reports.map((report) => report.params.seq);
        expect(sequence).toEqual([...sequence].sort((left, right) => left - right));
        expect(new Set(sequence).size).toBe(3);
      }).pipe(Effect.scoped),
    TEST_MILLIS,
  );

  it.effect(
    "an absent herdr socket never fails or blocks the command",
    () => reportPresence("working").pipe(Effect.provide(herdrPresenceLayer(scratchPane()))),
    TEST_MILLIS,
  );

  it.effect("the no-op layer accepts reports and reaches nothing", () =>
    reportPresence("settled").pipe(Effect.provide(AgentPresence.noop)),
  );
});

describe("reportWaitingDuring", () => {
  it.effect("closes the waiting span on success and on failure alike", () =>
    Effect.gen(function* () {
      const states: LifecycleState[] = [];
      const recording = Layer.sync(AgentPresence, () => ({
        report: (state: LifecycleState) =>
          Effect.sync(() => {
            states.push(state);
          }),
      }));
      yield* reportWaitingDuring(Effect.void).pipe(Effect.provide(recording));
      const failure = yield* reportWaitingDuring(Effect.fail("interrupted prompt")).pipe(
        Effect.flip,
        Effect.provide(recording),
      );
      expect(failure).toBe("interrupted prompt");
      expect(states).toEqual(["waiting", "working", "waiting", "working"]);
    }),
  );
});
