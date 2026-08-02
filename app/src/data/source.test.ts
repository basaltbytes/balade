/* The payload parse, on its own: the app never types a body it has not read. */

import { describe, expect, it } from "vitest";
import { parsePayload } from "./source";

const walkthrough = {
  walkthrough: 1,
  title: "Add live planning pool items",
  commit: "9f3c2ad",
  headDistance: 0,
  lang: "en",
  meta: {},
  pr: { number: 42, url: "https://example.test/pull/42" },
  files: [],
  nav: [],
  sections: [],
  errors: [],
  sourcePath: "walkthroughs/one.md",
  storageKey: "balade:acme/repo#42:walkthroughs/one.md",
};

const index = { kind: "index", repo: "acme/repo", entries: [] };

describe("parsePayload", () => {
  it("reads a walkthrough payload", () => {
    expect(parsePayload(walkthrough)).toBe(walkthrough);
  });

  it("reads an index payload", () => {
    expect(parsePayload(index)).toBe(index);
  });

  it("refuses another schema version", () => {
    expect(parsePayload({ ...walkthrough, walkthrough: 2 })).toBeNull();
  });

  it("refuses a payload with a field of the wrong shape", () => {
    expect(parsePayload({ ...walkthrough, sections: {} })).toBeNull();
    expect(parsePayload({ ...walkthrough, pr: "42" })).toBeNull();
    expect(parsePayload({ ...walkthrough, storageKey: 7 })).toBeNull();
    expect(parsePayload({ ...index, entries: null })).toBeNull();
  });

  it("refuses junk", () => {
    for (const junk of [null, undefined, 0, "payload", [], {}, { kind: "index" }]) {
      expect(parsePayload(junk)).toBeNull();
    }
  });
});
