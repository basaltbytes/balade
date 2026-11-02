import { join } from "node:path";
import { Effect, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest";
import { loadWalkthrough } from "../src/walkthrough/pipeline.js";
import {
  Block,
  Payload as PayloadSchema,
  ReviewState as ReviewStateSchema,
} from "../src/contract/schema.js";
import type { Payload, ReviewState } from "../src/contract/types.js";
import { decodePayload, PAYLOAD_FORMAT } from "../src/contract/payload.js";
import { provideLive } from "./support/effect.js";
import { createFixtureRepo, type FixtureRepo } from "./support/repo.js";

const strict = { onExcessProperty: "error" } as const;

describe("the payload schemas", () => {
  let repo: FixtureRepo;
  let payload: Payload;

  beforeAll(async () => {
    repo = createFixtureRepo();
    repo.addWalkthrough("valid.md", "valid.md");
    const loaded = await Effect.runPromise(
      provideLive(
        loadWalkthrough({
          cwd: repo.dir,
          path: join(repo.dir, "walkthroughs/valid.md"),
          useGh: false,
        }),
      ),
    );
    if (loaded.payload === null) throw new Error(JSON.stringify(loaded.diagnostics, null, 2));
    payload = loaded.payload;
  });

  afterAll(() => repo.cleanup());

  it("decodes and re-encodes a compiled walkthrough without changing its JSON", () => {
    const decoded = Effect.runSync(decodePayload(JSON.parse(JSON.stringify(payload))));
    expect(decoded.format).toBe(PAYLOAD_FORMAT);
    expect(Schema.encodeSync(PayloadSchema)(decoded)).toEqual(payload);
  });

  it.effect("identifies unsupported formats before reading their version-specific shape", () =>
    Effect.gen(function* () {
      expect(yield* Effect.flip(decodePayload({ format: 2 }))).toMatchObject({
        _tag: "PayloadFormatUnsupported",
        format: 2,
        message: expect.stringContaining("Recompile"),
      });
      expect(yield* Effect.flip(decodePayload({}))).toMatchObject({ _tag: "PayloadInvalid" });
      for (const format of [Number.MAX_SAFE_INTEGER + 1, 1.5, Infinity, "2", null]) {
        expect(yield* Effect.flip(decodePayload({ format }))).toMatchObject({
          _tag: "PayloadInvalid",
        });
      }
      expect(yield* Effect.flip(decodePayload({ ...payload, extra: true }))).toMatchObject({
        _tag: "PayloadInvalid",
      });
    }),
  );

  it.effect("admits only absolute HTTP and HTTPS PR links at the stored payload boundary", () =>
    Effect.gen(function* () {
      for (const url of ["https://forge.example.test/pulls/42", "http://localhost:8000/pr/42"]) {
        expect((yield* decodePayload({ ...payload, pr: { ...payload.pr, url } })).pr.url).toBe(url);
      }
      for (const url of [
        "javascript:alert(1)",
        "data:text/html,hello",
        "file:///tmp/review",
        "//example.test/pr/42",
        "https://",
        "not a URL",
      ]) {
        expect(
          yield* Effect.flip(decodePayload({ ...payload, pr: { ...payload.pr, url } })),
        ).toMatchObject({ _tag: "PayloadInvalid" });
      }
    }),
  );

  it("carries the authored groups of a files block across the JSON edge", () => {
    const block = {
      b: "files",
      paths: ["docs/old.md"],
      groups: [{ label: "Translations", paths: ["i18n/fr.po", "i18n/acme.pot"] }],
    };
    const decoded = Schema.decodeUnknownSync(Block, strict)(block);
    expect(Schema.encodeSync(Block)(decoded)).toEqual(block);
  });

  it("preserves the JSON data of a namespaced preset block", () => {
    const block = {
      b: "odoo/security",
      rows: [{ group: "base.group_user", read: true }],
      config: { inherited: false },
    };
    const decoded = Schema.decodeUnknownSync(Block, strict)(block);
    expect(Schema.encodeSync(Block)(decoded)).toEqual(block);
  });

  it("refuses preset data that cannot cross a JSON edge", () => {
    expect(() =>
      Schema.decodeUnknownSync(Block, strict)({ b: "odoo/security", config: undefined }),
    ).toThrow();
  });

  it("round-trips persisted review state", () => {
    const state: ReviewState = {
      version: 1,
      walkthrough: "walkthroughs/valid.md",
      pr: 42,
      stamp: "9f3c2ad",
      sections: { intro: { hash: "sha256:aa", at: "2026-01-01T09:00:00.000Z" } },
      files: {},
    };
    const decoded = Schema.decodeUnknownSync(ReviewStateSchema, strict)(state);
    expect(Schema.encodeSync(ReviewStateSchema)(decoded)).toEqual(state);
  });
});
