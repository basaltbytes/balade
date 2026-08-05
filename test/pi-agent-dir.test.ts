/** Balade's Pi state stays in its own agent directory, never `~/.pi/agent/`. */

import { Schema } from "effect";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { loadLiveDependencies } from "../src/pi/client.js";

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
});
