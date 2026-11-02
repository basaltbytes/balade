// @vitest-environment jsdom

/* The widget's seam is the renderer in `MermaidRendererContext`: a fake stands
   in for mermaid, which keeps the sink guard — the part that decides what
   reaches the page — under test without a browser. */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dictionaries } from "../i18n";
import { MermaidRendererContext } from "../mermaid/use-mermaid";
import type { MermaidRenderer } from "../mermaid/mermaid";
import { StringsProvider } from "../ui/strings";
import { RenderRuntimeProvider } from "../ui/render-runtime";
import { Mermaid } from "./mermaid";

const renderingTo = (svg: string): MermaidRenderer => ({ render: () => Promise.resolve(svg) });

const failing: MermaidRenderer = {
  render: () => Promise.reject(new Error("no diagram for you")),
};

describe("the mermaid widget", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  const draw = async (
    renderer: MermaidRenderer,
    source: string,
    lang: "en" | "fr" = "en",
  ): Promise<void> => {
    await act(async () =>
      root.render(
        <RenderRuntimeProvider>
          <StringsProvider lang={lang}>
            <MermaidRendererContext.Provider value={renderer}>
              <Mermaid block={{ b: "mermaid", source }} />
            </MermaidRendererContext.Provider>
          </StringsProvider>
        </RenderRuntimeProvider>,
      ),
    );
    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(container.querySelector("[data-mermaid]")?.getAttribute("data-mermaid")).not.toBe(
        "pending",
      );
    });
  };

  it("injects the drawn diagram", async () => {
    await draw(renderingTo('<svg id="d1"><g><text>pool item</text></g></svg>'), "graph TD\n a-->b");

    const drawn = container.querySelector('[data-mermaid="drawn"]');
    expect(drawn?.querySelector("svg")).not.toBeNull();
    expect(drawn?.textContent).toBe("pool item");
  });

  it("strips scripts, links and off-document references out of the diagram", async () => {
    await draw(
      renderingTo(
        [
          '<svg id="d2">',
          "<script>globalThis.pwned = true;</script>",
          '<a xlink:href="https://evil.example/" target="_blank"><text>node</text></a>',
          '<g onclick="globalThis.pwned = true"><text>handler</text></g>',
          '<image xlink:href="https://evil.example/pixel.png" />',
          '<defs><symbol id="icon-0" /></defs><use xlink:href="#icon-0" />',
          "</svg>",
        ].join(""),
      ),
      "graph TD\n a-->b",
    );

    const drawn = container.querySelector('[data-mermaid="drawn"]');
    expect(drawn?.querySelector("script")).toBeNull();
    expect(drawn?.querySelector("a")).toBeNull();
    expect(drawn?.innerHTML).not.toContain("evil.example");
    expect(drawn?.innerHTML).not.toContain("onclick");
    expect(drawn?.innerHTML).not.toContain("target=");
    /* The anchor's own content survives, and mermaid's internal references do. */
    expect(drawn?.textContent).toContain("node");
    expect(drawn?.querySelector("use")?.getAttribute("xlink:href")).toBe(
      `#${drawn?.querySelector("symbol")?.id}`,
    );
  });

  it.each([
    'graph TD\n a@{ img: "https://evil.example/pixel" }',
    'graph TD\n a@{ "img": "/pixel" }',
    "graph TD\n a@{ shape: image }",
    'graph TD\n a["<img src="/pixel">"]',
    "graph TD\n a[bad]\n style a fill:u/*comment*/rl(/pixel)",
    'graph TD\n a["/*"]\n b@{ img: "/pixel" }\n c["*/"]',
  ])("rejects resource syntax before the renderer can create an image: %s", async (source) => {
    let drawings = 0;
    await draw(
      {
        render: async () => {
          drawings += 1;
          return "<svg />";
        },
      },
      source,
    );
    expect(drawings).toBe(0);
    expect(container.querySelector('[data-mermaid="unavailable"]')).not.toBeNull();
  });

  it("falls back to the escaped source with a localized note", async () => {
    const source = 'graph TD\n  a["<script>globalThis.pwned = true;</script>"] --> b';
    await draw(failing, source);

    const fallback = container.querySelector('[data-mermaid="unavailable"]');
    expect(fallback?.querySelector("script")).toBeNull();
    expect(fallback?.querySelector("pre")?.textContent).toBe(source);
    expect(fallback?.textContent).toContain(dictionaries.en.mermaidUnavailable);

    await draw(failing, source, "fr");
    expect(container.querySelector('[data-mermaid="unavailable"]')?.textContent).toContain(
      dictionaries.fr.mermaidUnavailable,
    );
  });

  it("never calls the renderer for an empty source", async () => {
    let calls = 0;
    const counting: MermaidRenderer = {
      render: () => {
        calls += 1;
        return Promise.resolve("<svg />");
      },
    };

    await draw(counting, "");

    expect(calls).toBe(0);
    expect(container.querySelector('[data-mermaid="unavailable"]')).not.toBeNull();
  });

  it("ships the fallback note in both chrome languages", () => {
    expect(dictionaries.en.mermaidUnavailable).toBe(
      "This diagram could not be drawn; its source is shown instead.",
    );
    expect(dictionaries.fr.mermaidUnavailable).toBe(
      "Ce diagramme n’a pas pu être tracé ; sa source est affichée à la place.",
    );
  });
});
