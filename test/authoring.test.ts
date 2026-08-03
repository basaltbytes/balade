import { describe, expect, it } from "@effect/vitest";
import {
  AUTHORING_META_KEY,
  AUTHORING_PACKAGE_VERSION,
  AUTHORING_RUBRIC,
  AUTHORING_SECTION_TEMPLATES,
  AUTHORING_SYSTEM_PROMPT,
  AUTHORING_WALKTHROUGH_SCHEMA_VERSION,
} from "../src/generate/authoring.js";
import { renderDraft } from "../src/generate/run.js";
import type { PullSnapshot } from "../src/resolve/git.js";

const source: PullSnapshot = {
  root: "/fixture",
  repoSlug: "fixture/repo",
  pin: "abcdef1",
  base: "abcdef0",
  head: "abcdef1",
  pull: {
    number: 14,
    url: "https://github.com/fixture/repo/pull/14",
    author: "fixture-author",
    state: "open",
    base: "main",
    head: "feature/authoring",
    commits: 1,
    stats: { files: 1, additions: 1, deletions: 0 },
  },
  files: [],
  notices: [],
};

describe("the authoring package", () => {
  it("couples its major version to the walkthrough schema", () => {
    const major = Number(AUTHORING_PACKAGE_VERSION.split(".").at(0));
    expect(major).toBe(AUTHORING_WALKTHROUGH_SCHEMA_VERSION);
  });

  it("ships the canonical templates and four rubric axes", () => {
    expect(AUTHORING_SECTION_TEMPLATES.map((template) => template.group)).toEqual([
      "Orientation",
      "Models",
      "Surface",
      "Quality",
      "Deep dive",
    ]);
    expect(AUTHORING_RUBRIC.map((criterion) => criterion.id)).toEqual([
      "factual-accuracy",
      "section-selection",
      "reviewer-usefulness",
      "prose-quality",
    ]);
  });

  it("carries the authoring doctrine in the system prompt", () => {
    expect(AUTHORING_SYSTEM_PROMPT).toContain("ASD-STE100 Simplified Technical English");
    expect(AUTHORING_SYSTEM_PROMPT).toContain("Rédaction technique simplifiée");
    expect(AUTHORING_SYSTEM_PROMPT).toContain(
      "A changed file does not automatically deserve a section",
    );
    expect(AUTHORING_SYSTEM_PROMPT).toContain(`decorator="@api.constrains(\\"allocation_id\\")"`);
    expect(AUTHORING_SYSTEM_PROMPT).toContain("ordinary Markdown and a callout");
  });

  it("stamps the package version instead of trusting submitted metadata", () => {
    const rendered = renderDraft(source, {
      title: "Versioned draft",
      meta: { lang: "en", [AUTHORING_META_KEY]: "model-supplied" },
      body: `{% section id="overview" title="Overview" %}\nText.\n{% /section %}`,
    });

    expect(rendered).toContain(`${AUTHORING_META_KEY}: ${AUTHORING_PACKAGE_VERSION}`);
    expect(rendered).not.toContain("model-supplied");
  });
});
