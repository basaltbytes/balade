/* A payload-driven renderer fails per block kind, not globally, so the cheapest
   useful net is: render the whole fixture and see that nothing throws. The
   fixture exercises all 15 block families. */

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Payload } from "./contract";
import { pr96 } from "./fixtures/pr96";
import { WalkthroughRoute } from "./routes/walkthrough";
import { StringsProvider } from "./ui/strings";

const render = (payload: Payload, lang: "en" | "fr" = "en"): string =>
  renderToString(
    <StringsProvider lang={lang}>
      <WalkthroughRoute payload={payload} served={false} devStale={false} onToggleDevStale={null} />
    </StringsProvider>,
  );

describe("the walkthrough route", () => {
  const html = render(pr96);

  it("renders the header, the nav and every section", () => {
    expect(html).toContain("Add live planning pool items");
    for (const section of pr96.sections) expect(html).toContain(`id="${section.id}"`);
  });

  it("puts the review controls on screen", () => {
    expect(html).toContain("Mark reviewed");
    expect(html).toContain(`0/${pr96.sections.length} sections reviewed`);
    expect(html).toContain("Next unreviewed");
  });

  it("shows the expect ribbon of the mismatching block", () => {
    expect(html).toContain("expect mismatch");
  });

  it("renders an oversized code line as plain text with a localized notice", () => {
    const longLine = "<".repeat(6_000);
    const payload: Payload = {
      ...pr96,
      sections: [
        {
          id: "long-line",
          title: "Long line",
          hash: "sha256:long-line",
          blocks: [
            {
              b: "code",
              file: "scripts/adversarial.sh",
              from: 1,
              to: 1,
              lang: "shellscript",
              view: "plain",
              lines: [longLine],
              changed: [1],
            },
          ],
        },
      ],
    };

    const en = render(payload);
    expect(en).toContain("Line too long to highlight; shown as plain text.");
    expect(en).toContain("&lt;&lt;&lt;");

    const fr = render({ ...payload, lang: "fr" }, "fr");
    expect(fr).toContain(
      "Ligne trop longue pour la coloration syntaxique ; affichée en texte brut.",
    );
  });

  it("opens a code block unless the payload asks for it collapsed", () => {
    const codeSection = (collapsed: boolean): Payload => ({
      ...pr96,
      sections: [
        {
          id: "collapsed",
          title: "Collapsed",
          hash: "sha256:collapsed",
          blocks: [
            {
              b: "code",
              file: "models/planning_pool_item.py",
              from: 1,
              to: 1,
              lang: "python",
              view: "plain",
              ...(collapsed ? { collapsed: true } : {}),
              lines: ["from odoo import api"],
              changed: [1],
            },
          ],
        },
      ],
    });

    const closed = render(codeSection(true));
    expect(closed).toContain("bg-background collapsed");
    expect(closed).toContain("octicon-chevron-right");

    const open = render(codeSection(false));
    expect(open).not.toContain("bg-background collapsed");
    expect(open).toContain("octicon-chevron-down");
  });

  it("caps a payload-provided diagram at a 64 by 64 grid", () => {
    const payload: Payload = {
      ...pr96,
      sections: [
        {
          id: "large-diagram",
          title: "Large diagram",
          hash: "sha256:large-diagram",
          blocks: [
            {
              b: "diagram",
              nodes: [
                {
                  id: "far-away",
                  model: "FarAway",
                  change: "ctx",
                  col: 999_999_999,
                  row: 999_999_999,
                  compartments: [],
                },
              ],
              edges: [],
            },
          ],
        },
      ],
    };

    const rendered = render(payload);
    expect(rendered).toContain("grid-template-columns:repeat(64, minmax(0, 1fr))");
    expect(rendered).toContain("FarAway");
  });

  /* Mermaid needs a document and only ever loads from an effect hook, so server
     rendering neither imports it nor draws anything. */
  it("holds a mermaid block at its placeholder without reaching for mermaid", () => {
    const payload: Payload = {
      ...pr96,
      sections: [
        {
          id: "mermaid",
          title: "Mermaid",
          hash: "sha256:mermaid",
          blocks: [{ b: "mermaid", source: "graph TD\n  a --> b" }],
        },
      ],
    };

    const rendered = render(payload);
    expect(rendered).toContain('data-mermaid="pending"');
    expect(rendered).not.toContain('data-mermaid="drawn"');
    expect(rendered).not.toContain("a --&gt; b");
  });

  /* Grouping partitions the browser: every authored path keeps exactly one row,
     but a group's rows only exist once the reader opens it. */
  describe("a files browser with authored groups", () => {
    const tests = "addons/acme_planning/tests/test_planning_pool_item.py";
    const views = [
      "addons/acme_planning/views/planning_pool_item_views.xml",
      "addons/acme_planning/views/planning_slot_views.xml",
    ];
    const ungrouped = "addons/acme_planning/i18n/fr.po";

    const statsOf = (paths: string[]): string => {
      const known = pr96.files.filter((file) => paths.includes(file.path));
      const additions = known.reduce((sum, file) => sum + file.additions, 0);
      const deletions = known.reduce((sum, file) => sum + file.deletions, 0);
      return `${known.length} ${known.length === 1 ? "file" : "files"} changed · +${additions} −${deletions}`;
    };

    const grouped: Payload = {
      ...pr96,
      sections: [
        {
          id: "grouped-files",
          title: "Grouped files",
          hash: "sha256:grouped-files",
          blocks: [
            {
              b: "files",
              paths: [ungrouped],
              groups: [
                { label: "Tests unitaires", paths: [tests] },
                { label: "Vues XML", paths: views },
              ],
            },
          ],
        },
      ],
    };
    const groupedHtml = render(grouped);

    it("heads each group with its label and its own stats", () => {
      expect(groupedHtml).toContain("Tests unitaires");
      expect(groupedHtml).toContain("Vues XML");
      expect(groupedHtml).toContain(statsOf([tests]));
      expect(groupedHtml).toContain(statsOf(views));
      /* The browser head still counts the whole thing, groups included. */
      expect(groupedHtml).toContain(statsOf([tests, ...views, ungrouped]));
    });

    it("keeps a collapsed group's rows out of the render and the ungrouped rows in", () => {
      expect(groupedHtml).not.toContain("test_planning_pool_item.py");
      expect(groupedHtml).not.toContain("planning_slot_views.xml");
      expect(groupedHtml).toContain("fr.po");
    });

    it("renders a groups-less block as the flat row list", () => {
      const flat: Payload = {
        ...grouped,
        sections: [
          {
            id: "flat-files",
            title: "Flat files",
            hash: "sha256:flat-files",
            blocks: [{ b: "files", paths: [tests, ...views, ungrouped] }],
          },
        ],
      };

      const rendered = render(flat);
      expect(rendered).toContain("test_planning_pool_item.py");
      expect(rendered).toContain("planning_slot_views.xml");
      expect(rendered).toContain("fr.po");
      expect(rendered).toContain(statsOf([tests, ...views, ungrouped]));
    });
  });

  it("renders toned callouts as localized banners and leaves neutral callouts plain", () => {
    const callouts: Payload = {
      ...pr96,
      sections: [
        {
          id: "callouts",
          title: "Callouts",
          hash: "sha256:callouts",
          blocks: [
            { b: "callout", tone: "key", body: ["Key body"] },
            { b: "callout", tone: "warn", body: ["Warn body"] },
            { b: "callout", body: ["Neutral body"] },
          ],
        },
      ],
    };
    const en = render(callouts);

    expect(en).toContain("Key point");
    expect(en).toContain("Key body");
    expect(en).toContain("octicon-light-bulb text-primary");
    expect(en).toContain("Warning");
    expect(en).toContain("Warn body");
    expect(en).toContain("octicon-alert text-modified");
    expect(en).toContain(
      'border-border rounded-md bg-card px-4 py-3 leading-relaxed text-secondary-foreground">Neutral body',
    );

    const fr = render({ ...callouts, lang: "fr" }, "fr");
    expect(fr).toContain("Point clé");
    expect(fr).toContain("Attention");
  });

  it("renders code links before the browser computes their diff anchors", () => {
    expect(html).toContain(`href="${pr96.pr.url}/files"`);
    expect(html).toContain('aria-label="View this file&#x27;s diff on GitHub"');
  });

  it("surfaces the unresolved reference as an error card", () => {
    expect(html).toContain("range-unresolvable");
  });

  it("renders a labeled placeholder for a preset node it cannot draw", () => {
    const withPreset: Payload = {
      ...pr96,
      sections: [
        {
          id: "preset",
          title: "Preset",
          hash: "sha256:preset",
          blocks: [{ b: "odoo/security", rows: [] }],
        },
      ],
    };
    expect(render(withPreset)).toContain("odoo/security");
  });

  it("takes its chrome language from the payload", () => {
    const fr = render({ ...pr96, lang: "fr" }, "fr");
    expect(fr).toContain("Marquer comme relu");
    expect(fr).toContain("Voir le diff de ce fichier sur GitHub");
    expect(fr).not.toContain("Mark reviewed");
  });

  it("raises the stale banner only when the head has moved", () => {
    expect(html).not.toContain("head moved by");
    expect(render({ ...pr96, headDistance: 2 })).toContain("head moved by 2 commits");
  });
});
