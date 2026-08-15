/**
 * Herdr presence through the real socket seam: a local server stands in for
 * herdr, so the suite proves the frame dialect, state coalescing, inert unused
 * lifecycles, the settled flush at scope close, and failure isolation.
 */

import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer, Schema } from "effect";
import {
  AgentPresence,
  agentPresenceLive,
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
function startServer(endpoint: string, firstAckDelayMillis = 0): Promise<FrameServer> {
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
        const acknowledge = () => socket.write('{"ok":true}\n');
        if (frames.length === 1 && firstAckDelayMillis > 0) {
          setTimeout(acknowledge, firstAckDelayMillis);
        } else {
          acknowledge();
        }
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
  id: Schema.String,
  method: Schema.Literal("pane.report_agent"),
  params: Schema.Struct({
    pane_id: Schema.Literal(PANE_ID),
    source: Schema.Literal("custom:balade"),
    agent: Schema.Literal("balade"),
    state: Schema.Literals(["working", "blocked", "idle"]),
    seq: Schema.Int,
  }),
});
const decodeReport = Schema.decodeUnknownEffect(ReportRequest, {
  onExcessProperty: "error",
});

const serverFor = (socketPath: string, firstAckDelayMillis = 0) =>
  Effect.acquireRelease(
    Effect.promise(() => startServer(herdrEndpoint(socketPath), firstAckDelayMillis)),
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
  it.live(
    "builds the live adapter from Effect configuration",
    () =>
      Effect.gen(function* () {
        const pane = scratchPane();
        const server = yield* serverFor(pane.socketPath);
        const config = ConfigProvider.fromUnknown({
          HERDR_ENV: "1",
          HERDR_SOCKET_PATH: pane.socketPath,
          HERDR_PANE_ID: pane.paneId,
        });
        const presence = agentPresenceLive.pipe(Layer.provide(ConfigProvider.layer(config)));

        yield* Effect.gen(function* () {
          yield* reportPresence("working");
          yield* awaitFrames(server, 1);
        }).pipe(Effect.provide(presence));

        const reports = yield* Effect.forEach(server.frames, (frame) => decodeReport(frame));
        expect(reports.map((report) => report.params.state)).toEqual(["working", "idle"]);
      }).pipe(Effect.scoped),
    TEST_MILLIS,
  );

  it.live(
    "reports transitions in herdr's dialect and flushes settled at scope close",
    () =>
      Effect.gen(function* () {
        const pane = scratchPane();
        const server = yield* serverFor(pane.socketPath);

        yield* Effect.gen(function* () {
          yield* reportPresence("working");
          yield* awaitFrames(server, 1);
          yield* reportPresence("waiting");
          yield* awaitFrames(server, 2);
        }).pipe(Effect.provide(herdrPresenceLayer(pane)));

        /* The finalizer completes before the layer scope closes. */
        expect(server.frames).toHaveLength(3);
        const reports = yield* Effect.forEach(server.frames, (frame) => decodeReport(frame));
        expect(reports.map((report) => report.params.state)).toEqual([
          "working",
          "blocked",
          "idle",
        ]);
        const sequence = reports.map((report) => report.params.seq);
        expect(sequence).toEqual([...sequence].sort((left, right) => left - right));
        expect(new Set(sequence).size).toBe(3);
        expect(reports.map((report) => report.id)).toEqual(
          sequence.map((seq) => `custom:balade:${seq}`),
        );
      }).pipe(Effect.scoped),
    TEST_MILLIS,
  );

  it.live(
    "keeps only the latest state pending behind an in-flight report",
    () =>
      Effect.gen(function* () {
        const pane = scratchPane();
        const server = yield* serverFor(pane.socketPath, 100);

        yield* Effect.gen(function* () {
          yield* reportPresence("working");
          yield* awaitFrames(server, 1);
          yield* reportPresence("waiting");
          yield* reportPresence("working");
          yield* awaitFrames(server, 2);
        }).pipe(Effect.provide(herdrPresenceLayer(pane)));

        const reports = yield* Effect.forEach(server.frames, (frame) => decodeReport(frame));
        expect(reports.map((report) => report.params.state)).toEqual([
          "working",
          "working",
          "idle",
        ]);
      }).pipe(Effect.scoped),
    TEST_MILLIS,
  );

  it.live(
    "sends nothing when a command acquires the service but never reports presence",
    () =>
      Effect.gen(function* () {
        const pane = scratchPane();
        const server = yield* serverFor(pane.socketPath);

        yield* AgentPresence.use(() => Effect.void).pipe(Effect.provide(herdrPresenceLayer(pane)));

        expect(server.frames).toEqual([]);
      }).pipe(Effect.scoped),
    TEST_MILLIS,
  );

  it.live(
    "an absent herdr socket never fails the command",
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
        report: Effect.fn("AgentPresence.recording.report")((state: LifecycleState) =>
          Effect.sync(() => {
            states.push(state);
          }),
        ),
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
