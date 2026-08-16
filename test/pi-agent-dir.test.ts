/** Balade's Pi state stays in its own agent directory, never `~/.pi/agent/`. */

import { Effect, Layer, Schema } from "effect";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { WalkthroughAuthor } from "../src/pi/author.js";
import { loadLiveDependencies, piWalkthroughAuthorLayer } from "../src/pi/client.js";
import { shellLayer } from "./support/effect.js";

const SavedDefaults = Schema.Struct({
  defaultProvider: Schema.String,
  defaultModel: Schema.String,
});

describe("balade Pi agent directory", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  function temporaryAgentDir(): string {
    const directory = mkdtempSync(join(tmpdir(), "balade-pi-dir-"));
    cleanups.push(() =>
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
    );
    return directory;
  }

  it("writes the remembered model to its own settings.json", async () => {
    const agentDir = temporaryAgentDir();
    const { settingsManager } = await loadLiveDependencies(agentDir);
    settingsManager.setDefaultModelAndProvider("faux", "faux-model");
    await settingsManager.flush();
    expect(settingsManager.drainErrors()).toEqual([]);
    const settings = Schema.decodeUnknownSync(SavedDefaults)(
      JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")),
    );
    expect(settings.defaultProvider).toBe("faux");
    expect(settings.defaultModel).toBe("faux-model");
  });

  it("reads credentials from its own auth.json", async () => {
    const agentDir = temporaryAgentDir();
    writeFileSync(
      join(agentDir, "auth.json"),
      JSON.stringify({ anthropic: { type: "api_key", key: "sk-balade-isolated" } }),
      "utf8",
    );
    const { modelRuntime } = await loadLiveDependencies(agentDir);
    const credentials = await modelRuntime.listCredentials();
    expect(credentials.map((credential) => credential.providerId)).toContain("anthropic");
  });

  it.effect("logs out every credential and remains idempotent when the store is empty", () =>
    Effect.gen(function* () {
      const agentDir = temporaryAgentDir();
      writeFileSync(
        join(agentDir, "auth.json"),
        JSON.stringify({
          anthropic: { type: "api_key", key: "sk-balade-anthropic" },
          openai: { type: "api_key", key: "sk-balade-openai" },
        }),
        "utf8",
      );
      const authorLayer = piWalkthroughAuthorLayer({
        load: () => loadLiveDependencies(agentDir),
      }).pipe(Layer.provideMerge(shellLayer));
      const author = yield* WalkthroughAuthor.pipe(Effect.provide(authorLayer));

      yield* author.logout;
      yield* author.logout;

      const { modelRuntime } = yield* Effect.promise(() => loadLiveDependencies(agentDir));
      expect(yield* Effect.promise(() => modelRuntime.listCredentials())).toEqual([]);
    }),
  );

  it.effect("reports credential runtime loading as a typed read failure", () =>
    Effect.gen(function* () {
      const authorLayer = piWalkthroughAuthorLayer({
        load: async () => {
          throw new Error("fixture runtime failed");
        },
      }).pipe(Layer.provideMerge(shellLayer));
      const author = yield* WalkthroughAuthor.pipe(Effect.provide(authorLayer));

      const error = yield* Effect.flip(author.logout);
      expect(error._tag).toBe("AuthorCredentialReadFailed");
    }),
  );
});
