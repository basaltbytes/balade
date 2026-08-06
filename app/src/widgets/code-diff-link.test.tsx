// @vitest-environment jsdom

import { webcrypto } from "node:crypto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StringsProvider } from "../ui/strings";
import { CodeDiffLink } from "./code-diff-link";

describe("the code block's GitHub diff link", () => {
  const jsdomCrypto = globalThis.crypto;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: jsdomCrypto });
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it("upgrades the fallback to the file and right-side line anchor", async () => {
    await act(async () =>
      root.render(
        <StringsProvider lang="en">
          <CodeDiffLink
            prUrl="https://github.com/acme-co/planning-suite/pull/96"
            file="addons/acme_planning/models/planning_pool_item.py"
            line={5}
          />
        </StringsProvider>,
      ),
    );

    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(container.querySelector("a")?.getAttribute("href")).toBe(
        "https://github.com/acme-co/planning-suite/pull/96/files#diff-de5833c383c5fc39e56eabfdb055fda1cbb6e0eba5828eb290156af7b807f297R5",
      );
    });

    const link = container.querySelector("a");
    if (!(link instanceof HTMLAnchorElement)) throw new Error("the diff link did not render");
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noreferrer");
    expect(link.title).toBe("View this file's diff on GitHub");
    expect(link.getAttribute("aria-label")).toBe("View this file's diff on GitHub");
  });
});
