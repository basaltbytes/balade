/** A scripted terminal stream that exercises the real TTY rendering path. */

import { Writable } from "node:stream";
import type { TerminalStream } from "../../src/terminal.js";

export interface ScriptedTerminal {
  readonly chunks: string[];
  readonly stream: TerminalStream;
}

export function scriptedTerminal(mode: "tty" | "pipe"): ScriptedTerminal {
  const chunks: string[] = [];
  const writable = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  const stream: TerminalStream = Object.assign(writable, { isTTY: mode === "tty" });
  return { chunks, stream };
}
