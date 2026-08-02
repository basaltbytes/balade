import { describe, expect, it } from "vitest";
import type { Payload, ReviewState, Section } from "../contract";
import {
  fileKey,
  fileProgress,
  isComplete,
  nextUnreviewed,
  reconcile,
  sectionProgress,
  toggleFile,
  toggleSection,
} from "./review";

const section = (id: string, hash: string, extra?: Partial<Section>): Section => ({
  id,
  title: id.toUpperCase(),
  hash,
  blocks: [],
  ...extra,
});

const payload = (sections: Section[], files: Payload["files"] = []): Payload => ({
  walkthrough: 1,
  title: "t",
  commit: "abc",
  headDistance: 0,
  lang: "en",
  meta: {},
  pr: {
    number: 1,
    url: "u",
    author: "a",
    state: "open",
    base: "main",
    head: "feat",
    commits: 1,
    stats: { files: files.length, additions: 0, deletions: 0 },
  },
  files,
  nav: [],
  sections,
  errors: [],
  sourcePath: "walkthroughs/one.md",
  storageKey: "balade:acme/repo#1:walkthroughs/one.md",
});

const file = (path: string, hash: string): Payload["files"][number] => ({
  path,
  status: "M",
  additions: 1,
  deletions: 0,
  hash,
  lang: "python",
  diff: null,
});

const state = (over: Partial<ReviewState>): ReviewState => ({
  version: 1,
  walkthrough: "walkthroughs/one.md",
  pr: 1,
  stamp: "abc",
  sections: {},
  files: {},
  ...over,
});

const at = "2026-08-01T10:00:00.000Z";

describe("reconcile — the hash reset rule", () => {
  it("keeps marks whose hash still matches", () => {
    const p = payload([section("one", "h1"), section("two", "h2")]);
    const outcome = reconcile(p, state({ sections: { one: { hash: "h1", at } } }));
    expect(outcome.state.sections.one).toEqual({ hash: "h1", at });
    expect(outcome.reset.sections).toEqual([]);
    expect(outcome.changed).toBe(false);
  });

  it("drops marks whose hash moved and names the section", () => {
    const p = payload([section("one", "h1-new")]);
    const outcome = reconcile(p, state({ sections: { one: { hash: "h1", at } } }));
    expect(outcome.state.sections.one).toBeUndefined();
    expect(outcome.reset.sections).toEqual(["ONE"]);
    expect(outcome.changed).toBe(true);
  });

  it("drops marks of vanished sections without reporting them", () => {
    const p = payload([section("two", "h2")]);
    const outcome = reconcile(p, state({ sections: { gone: { hash: "hx", at } } }));
    expect(outcome.state.sections).toEqual({});
    expect(outcome.reset.sections).toEqual([]);
  });

  it("applies the same rule to section-scoped file marks", () => {
    const p = payload([section("one", "h1")], [file("a.py", "fa"), file("b.py", "fb-new")]);
    const outcome = reconcile(
      p,
      state({
        files: {
          [fileKey("one", "a.py")]: { hash: "fa", at },
          [fileKey("one", "b.py")]: { hash: "fb", at },
          [fileKey("one", "gone.py")]: { hash: "fg", at },
        },
      }),
    );
    expect(Object.keys(outcome.state.files)).toEqual([fileKey("one", "a.py")]);
    expect(outcome.reset.files).toEqual(["b.py"]);
  });

  it("starts empty when nothing was stored", () => {
    const p = payload([section("one", "h1")]);
    const outcome = reconcile(p, null);
    expect(outcome.state).toEqual(state({}));
    expect(outcome.changed).toBe(false);
  });
});

describe("progress", () => {
  const p = payload(
    [
      section("one", "h1"),
      section("two", "h2", {
        blocks: [{ b: "files", paths: ["a.py", "b.py", "unknown.py"] }],
      }),
      section("three", "h3"),
    ],
    [file("a.py", "fa"), file("b.py", "fb")],
  );

  it("counts sections, not files", () => {
    let current = state({});
    expect(sectionProgress(p, current)).toEqual({ done: 0, total: 3 });
    current = toggleSection(p, current, "one", at);
    current = toggleFile(p, current, "two", "a.py", at);
    expect(sectionProgress(p, current)).toEqual({ done: 1, total: 3 });
    expect(isComplete(p, current)).toBe(false);
  });

  it("reports a files browser as n/m, ignoring paths the PR does not carry", () => {
    const two = p.sections[1];
    if (!two) throw new Error("fixture");
    let current = state({});
    expect(fileProgress(p, current, two)).toEqual({ done: 0, total: 2 });
    current = toggleFile(p, current, "two", "a.py", at);
    expect(fileProgress(p, current, two)).toEqual({ done: 1, total: 2 });
    const one = p.sections[0];
    if (!one) throw new Error("fixture");
    expect(fileProgress(p, current, one)).toBeNull();
  });

  it("unmarks on a second toggle", () => {
    const marked = toggleSection(p, state({}), "one", at);
    expect(toggleSection(p, marked, "one", at).sections.one).toBeUndefined();
  });

  it("walks to the next unreviewed section and wraps around", () => {
    const current = toggleSection(p, state({}), "two", at);
    expect(nextUnreviewed(p, current)).toBe("one");
    expect(nextUnreviewed(p, current, "one")).toBe("three");
    expect(nextUnreviewed(p, current, "three")).toBe("one");
  });

  it("returns nothing to jump to once every section is marked", () => {
    let current = state({});
    for (const s of p.sections) current = toggleSection(p, current, s.id, at);
    expect(isComplete(p, current)).toBe(true);
    expect(nextUnreviewed(p, current)).toBeNull();
  });
});
