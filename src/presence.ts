/**
 * Agent presence for terminal multiplexers. Balade's observable lifecycle is
 * its own — `working`, `waiting` on the operator, `settled` — and every
 * multiplexer dialect is one adapter behind this port. The first adapter
 * speaks herdr's socket self-report; a pane outside herdr gets the no-op.
 *
 * Reports carry only the fixed literals below — never text derived from a
 * pull request — so no untrusted byte reaches a multiplexer socket.
 */

import net from "node:net";
import { Context, Effect, Layer, Queue } from "effect";

/** Balade's semantic lifecycle states; adapters translate to their dialect. */
export type LifecycleState = "working" | "waiting" | "settled";

export interface AgentPresencePort {
  /** Fire-and-forget: delivery never fails, blocks, or outlives its budget. */
  readonly report: (state: LifecycleState) => Effect.Effect<void>;
}

/** The one presence port. Commands report transitions; adapters deliver them. */
export class AgentPresence extends Context.Service<AgentPresence, AgentPresencePort>()(
  "@balade/AgentPresence",
) {
  static readonly noop = Layer.sync(AgentPresence, () => ({ report: () => Effect.void }));
}

export const reportPresence = (state: LifecycleState) =>
  AgentPresence.use((presence) => presence.report(state));

/**
 * Bracket an operator interaction: `waiting` on entry, `working` again on any
 * exit. Callers cannot leave the span open on an early return or failure.
 */
export const reportWaitingDuring = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | AgentPresence> =>
  reportPresence("waiting").pipe(
    Effect.andThen(effect),
    Effect.ensuring(reportPresence("working")),
  );

/** The pane identity herdr injects into every terminal it manages. */
export interface HerdrPane {
  readonly socketPath: string;
  readonly paneId: string;
}

/** A pane is herdr's only when all three variables are present and non-empty. */
export function herdrPane(env: Record<string, string | undefined>): HerdrPane | undefined {
  const socketPath = env["HERDR_SOCKET_PATH"] ?? "";
  const paneId = env["HERDR_PANE_ID"] ?? "";
  return env["HERDR_ENV"] === "1" && socketPath !== "" && paneId !== ""
    ? { socketPath, paneId }
    : undefined;
}

/** Windows exposes the socket as a named pipe; elsewhere the path is literal. */
export const herdrEndpoint = (socketPath: string): string =>
  process.platform === "win32" ? `\\\\.\\pipe\\${socketPath}` : socketPath;

/** Herdr semantics: `blocked` is its approval/question state, `idle` its rest state. */
const HERDR_STATE = {
  working: "working",
  waiting: "blocked",
  settled: "idle",
} as const satisfies Record<LifecycleState, string>;

const FIRST_ATTEMPT_MILLIS = 500;
const RETRY_ATTEMPT_MILLIS = 1500;

/**
 * Herdr's self-report dialect: one newline-delimited JSON request per state
 * change to `pane.report_agent`, acknowledged by any response bytes. Reports
 * coalesce through a sliding queue — only the latest pending state matters —
 * and a scope finalizer always flushes `settled`, so a pane never exits stuck
 * on `working`.
 */
export const herdrPresenceLayer = (pane: HerdrPane): Layer.Layer<AgentPresence> =>
  Layer.effect(
    AgentPresence,
    Effect.gen(function* () {
      const endpoint = herdrEndpoint(pane.socketPath);
      /* Wall-clock seed: the pane outlives this process, and herdr orders
         reports per source by `seq`, so a restart must not rewind it. */
      let seq = Date.now() * 1000;
      let attempted: LifecycleState | undefined;

      const send = Effect.fn("AgentPresence.send")(function* (state: LifecycleState) {
        attempted = state;
        seq++;
        const frame = `${JSON.stringify({
          id: `custom:balade:${seq}`,
          method: "pane.report_agent",
          params: {
            pane_id: pane.paneId,
            source: "custom:balade",
            agent: "balade",
            state: HERDR_STATE[state],
            seq,
          },
        })}\n`;
        if (!(yield* deliver(endpoint, frame, FIRST_ATTEMPT_MILLIS))) {
          yield* deliver(endpoint, frame, RETRY_ATTEMPT_MILLIS);
        }
      });

      const queue = yield* Queue.sliding<LifecycleState>(1);
      /* Registered before the drainer fork, so it runs after the drainer's
         interruption and owns the socket's last word. Unconditional: a
         duplicate idle report is harmless, a pane stuck `working` is not. */
      yield* Effect.addFinalizer(() => send("settled"));
      yield* Effect.forkScoped(
        Effect.gen(function* () {
          while (true) {
            const state = yield* Queue.take(queue);
            if (state !== attempted) yield* send(state);
          }
        }),
      );

      return {
        report: (state: LifecycleState) => Queue.offer(queue, state).pipe(Effect.asVoid),
      } satisfies AgentPresencePort;
    }),
  );

/** The live wiring: a herdr pane reports to herdr, any other pane nowhere. */
export const agentPresenceLive: Layer.Layer<AgentPresence> = Layer.suspend(() => {
  const pane = herdrPane(process.env);
  return pane === undefined ? AgentPresence.noop : herdrPresenceLayer(pane);
});

/* One short-lived connection per report, herdr's expected client shape. Every
   outcome — refused, hung, interrupted — resolves false; presence must never
   fail a command. */
const deliver = (endpoint: string, frame: string, timeoutMillis: number) =>
  Effect.callback<boolean>((resume) => {
    let done = false;
    const socket = net.createConnection(endpoint);
    const finish = (outcome: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      resume(Effect.succeed(outcome));
    };
    const timer = setTimeout(() => finish(false), timeoutMillis);
    socket.on("connect", () => socket.write(frame));
    socket.on("data", () => finish(true));
    socket.on("error", () => finish(false));
    socket.on("end", () => finish(false));
    return Effect.sync(() => {
      done = true;
      clearTimeout(timer);
      socket.destroy();
    });
  });
