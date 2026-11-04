// @vitest-environment jsdom

import { webcrypto } from "node:crypto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Diff, type DiffFile, type DiffProps } from "./viewer";

const renamed: DiffFile = {
  path: "src/billing/invoice-total.ts",
  oldPath: "src/billing/total.ts",
  status: "renamed",
  additions: 1,
  deletions: 1,
  patch: {
    kind: "text",
    text: "@@ -1,3 +1,3 @@\n export function total(lines: Line[]) {\n-  return sum(lines);\n+  return sum(lines.filter(isBillable));\n }",
  },
};

const truncated: DiffFile = {
  path: "src/billing/rates.ts",
  status: "modified",
  additions: 40,
  deletions: 0,
  patch: {
    kind: "text",
    text: "@@ -1,2 +1,42 @@\n import { rate } from './rate';\n+export const EUR = rate('EUR');\n+export const USD = rate('USD');",
    truncated: true,
  },
};

const binary: DiffFile = {
  path: "assets/logo.png",
  status: "added",
  additions: 0,
  deletions: 0,
  patch: { kind: "binary" },
};

const lockfile: DiffFile = {
  path: "pnpm-lock.yaml",
  status: "modified",
  additions: 900,
  deletions: 300,
  patch: { kind: "omitted" },
  generated: true,
};

const spec: DiffFile = {
  path: "test/billing/total.test.ts",
  status: "added",
  additions: 1,
  deletions: 0,
  patch: { kind: "text", text: "@@ -0,0 +1 @@\n+it('totals billable lines', () => {});" },
  test: true,
};

const hostile: DiffFile = {
  path: "src/<b>bold</b>.ts",
  status: "modified",
  additions: 1,
  deletions: 0,
  patch: { kind: "text", text: '@@ -1 +1,2 @@\n x\n+<img src="x" onerror="alert(1)">' },
};

describe("the standalone Diff", () => {
  const jsdomCrypto = globalThis.crypto;
  const canvas = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
    /* The diff view measures text widths and watches rows; jsdom has neither. */
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: () => ({ font: "", measureText: (text: string) => ({ width: text.length * 7 }) }),
    });
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: jsdomCrypto });
    if (canvas !== undefined)
      Object.defineProperty(HTMLCanvasElement.prototype, "getContext", canvas);
    Reflect.deleteProperty(globalThis, "IntersectionObserver");
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
    vi.restoreAllMocks();
  });

  const render = async (props: DiffProps) => {
    await act(async () => root.render(<Diff {...props} />));
  };

  const rowOf = (path: string): HTMLElement => {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const head = [...container.querySelectorAll<HTMLElement>(".file-head")].find((element) =>
      element.textContent?.includes(name),
    );
    const row = head?.parentElement;
    if (row === null || row === undefined) throw new Error(`no row for ${path}`);
    return row;
  };

  const toggle = (row: HTMLElement): HTMLButtonElement => {
    const button = row.querySelector<HTMLButtonElement>("button[aria-expanded]");
    if (button === null) throw new Error("no toggle");
    return button;
  };

  it("renders a host's files without a walkthrough payload, in a scoped root", async () => {
    const before = {
      title: document.title,
      html: document.documentElement.outerHTML.length,
      head: document.head.innerHTML,
    };
    const fetch = vi.spyOn(globalThis, "fetch");
    await render({ files: [renamed, truncated, binary, lockfile, spec] });

    expect(container.firstElementChild?.classList.contains("balade-viewer")).toBe(true);
    expect(container.textContent).toContain("5 files changed · +942 −301");
    for (const file of [renamed, truncated, binary, lockfile, spec]) {
      expect(toggle(rowOf(file.path)).getAttribute("aria-expanded")).toBe("false");
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(document.title).toBe(before.title);
    expect(document.head.innerHTML).toBe(before.head);
  });

  it("shows a rename with its old path and its diff", async () => {
    await render({ files: [renamed], defaultExpanded: true });
    const row = rowOf(renamed.path);
    expect(row.textContent).toContain("renamed from src/billing/total.ts");
    expect(row.textContent).toContain("return sum(lines.filter(isBillable));");
  });

  it("says a rename without a hunk changed no content", async () => {
    const moved: DiffFile = {
      path: "src/billing/moved.ts",
      oldPath: "src/moved.ts",
      status: "renamed",
      additions: 0,
      deletions: 0,
      patch: { kind: "text", text: "" },
    };
    await render({ files: [moved], defaultExpanded: true });
    expect(rowOf(moved.path).textContent).toContain("No content changes.");
  });

  it("shows what a truncated patch has and says the rest is missing", async () => {
    await render({ files: [truncated], defaultExpanded: true });
    const row = rowOf(truncated.path);
    expect(row.textContent).toContain(
      "This diff is truncated; later changes to this file are not shown.",
    );
    expect(row.textContent).toContain("export const USD = rate('USD');");
  });

  it("names a binary file and an omitted patch instead of drawing a diff", async () => {
    await render({ files: [binary, lockfile], defaultExpanded: true });
    expect(rowOf(binary.path).textContent).toContain("Binary file — no diff to show.");

    /* Generated files stay collapsed even when the host expands the rest. */
    const lock = rowOf(lockfile.path);
    expect(toggle(lock).getAttribute("aria-expanded")).toBe("false");
    await act(async () => toggle(lock).click());
    expect(lock.textContent).toContain("No diff available for this file.");
  });

  it("marks test and generated files", async () => {
    await render({ files: [spec, lockfile, renamed], lang: "fr" });
    expect(rowOf(spec.path).querySelector(".file-head")?.textContent).toContain("test");
    expect(rowOf(lockfile.path).querySelector(".file-head")?.textContent).toContain("généré");
    expect(rowOf(renamed.path).querySelector(".file-head")?.textContent).not.toContain("test");
  });

  it("links each file to the host and hands clicks to the host", async () => {
    const opened: string[] = [];
    await render({
      files: [renamed, hostile],
      fileHref: (file) => (file === hostile ? "javascript:alert(1)" : `/files/${file.path}`),
      onFileOpen: (file, event) => {
        event.preventDefault();
        opened.push(file.path);
      },
    });

    const link = rowOf(renamed.path).querySelector("a");
    expect(link?.getAttribute("href")).toBe("/files/src/billing/invoice-total.ts");
    expect(link?.getAttribute("aria-label")).toBe("Open src/billing/invoice-total.ts");
    await act(async () => link?.click());
    expect(opened).toEqual([renamed.path]);

    /* A non-HTTP link is dropped; the callback still gets a button. */
    const row = rowOf(hostile.path);
    expect(row.querySelector("a")).toBeNull();
    const button = row.querySelector<HTMLButtonElement>('button[aria-label^="Open"]');
    await act(async () => button?.click());
    expect(opened).toEqual([renamed.path, hostile.path]);
  });

  it("renders untrusted paths and patch text as text", async () => {
    await render({ files: [hostile], defaultExpanded: true });
    const row = rowOf(hostile.path);
    expect(row.querySelector("img")).toBeNull();
    expect(row.querySelector("b")).toBeNull();
    expect(row.textContent).toContain('<img src="x" onerror="alert(1)">');
    expect(row.textContent).toContain("<b>bold</b>.ts");
  });

  it("rejects files that do not match the props type", async () => {
    /* A JavaScript caller is not held to the prop types. */
    const files: ReadonlyArray<DiffFile> = JSON.parse('[{ "path": "a.ts", "status": "copied" }]');
    await render({ files });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "The file changes do not match the format this component reads.",
    );
  });
});
