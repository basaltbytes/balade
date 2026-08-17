/** The real process seam: scheduler responsiveness, failures and interruption. */

import { describe, expect, it } from "@effect/vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Fiber } from "effect";
import { CommandExecutor, exec } from "../src/shell.js";

describe("command executor", () => {
  it.live("keeps the Effect scheduler responsive while a child process runs", () =>
    Effect.gen(function* () {
      let timerFired = false;
      const timer = yield* Effect.forkChild(
        Effect.sleep("20 millis").pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              timerFired = true;
            }),
          ),
        ),
      );

      const output = yield* exec(
        process.execPath,
        ["-e", "setTimeout(() => process.stdout.write('done'), 100)"],
        process.cwd(),
      );

      expect(timerFired).toBe(true);
      expect(output).toBe("done");
      yield* Fiber.join(timer);
    }).pipe(Effect.provide(CommandExecutor.layer)),
  );

  it.live("terminates the child process when the owning fiber is interrupted", () =>
    Effect.gen(function* () {
      const directory = yield* Effect.acquireRelease(
        Effect.sync(() => mkdtempSync(join(tmpdir(), "balade-shell-interrupt-"))),
        (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
      );
      const marker = join(directory, "child-survived");
      const child = yield* Effect.forkChild(
        exec(
          process.execPath,
          [
            "-e",
            "setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'alive'), 250)",
            marker,
          ],
          process.cwd(),
        ),
      );
      yield* Effect.sleep("50 millis");

      yield* Fiber.interrupt(child);
      yield* Effect.sleep("350 millis");

      expect(existsSync(marker)).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(CommandExecutor.layer)),
  );

  it.effect("preserves a command's exit code and stderr as a typed failure", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        exec(
          process.execPath,
          ["-e", "process.stderr.write('failure detail'); process.exit(7)"],
          process.cwd(),
        ),
      );

      expect(error).toMatchObject({
        _tag: "CommandFailed",
        file: process.execPath,
        stderr: "failure detail",
        code: 7,
      });
    }).pipe(Effect.provide(CommandExecutor.layer)),
  );
});
