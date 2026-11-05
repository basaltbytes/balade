/** Browser acceptance test against the installed @balade/viewer, sharing the host's React and Effect. */
import assert from "node:assert/strict";
import { cp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(process.argv[2] ?? join(here, ".."));
/* The standalone stylesheet ships with the CLI, which the viewer host does not install. */
const cliProject = resolve(process.argv[3] ?? project);
const packageRoot = dirname(
  createRequire(join(cliProject, "package.json")).resolve("balade/package.json"),
);
const fixture = join(project, ".balade", "viewer-fixture");
await cp(join(here, "viewer-fixture"), fixture, { recursive: true });
await build({
  root: fixture,
  configFile: false,
  plugins: [react(), tailwindcss()],
  logLevel: "error",
  build: { outDir: "build", emptyOutDir: true },
});
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  try {
    const body = await readFile(join(fixture, "build", path === "/" ? "index.html" : path));
    response.setHeader(
      "Content-Type",
      path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : "text/html",
    );
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
assert.ok(address && address instanceof Object && "port" in address);
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const violations = [];
  const requests = [];
  const errors = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error("Page error", error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") console.error(message.text());
  });
  await page.exposeFunction("recordViolation", (value) => violations.push(value));
  await page.addInitScript(() =>
    document.addEventListener("securitypolicyviolation", (event) =>
      globalThis.recordViolation(`${event.violatedDirective}: ${event.blockedURI}`),
    ),
  );
  await page.goto(origin);
  const hostState = () =>
    page.evaluate(() => {
      const heading = document.getElementById("overview");
      const button = document.getElementById("mount");
      return {
        title: document.title,
        location: location.href,
        html: document.documentElement.outerHTML.split(">")[0],
        overflow: document.documentElement.style.overflow,
        heading: getComputedStyle(heading).cssText,
        color: getComputedStyle(heading).color,
        font: getComputedStyle(heading).fontFamily,
        buttonRadius: getComputedStyle(button).borderRadius,
        bodyMargin: getComputedStyle(document.body).margin,
        bodyChildren: [...document.body.children].map((element) => element.id),
      };
    });
  const before = await hostState();
  await page.locator("#mount").click();
  await page
    .locator('#first [data-mermaid="drawn"]')
    .first()
    .waitFor({ timeout: 15000 })
    .catch(async (error) => {
      console.error(await page.locator("#first").innerText());
      await page.screenshot({ path: "/tmp/balade-viewer-failure.png" });
      throw error;
    });
  await page.locator("#first pre.shiki span[style]").first().waitFor();
  assert.deepEqual(await hostState(), before);
  assert.equal(
    await page.locator("#unsupported [role=alert]").textContent(),
    "Ce format de parcours n’est pas pris en charge. Recompilez le parcours.",
  );
  assert.ok(await page.locator("#invalid-url [role=alert]").count());
  const ids = await page
    .locator("[id]")
    .evaluateAll((elements) => elements.map((element) => element.id));
  assert.equal(new Set(ids).size, ids.length, "DOM IDs collide across instances");
  assert.equal(
    await page
      .locator(
        '#first script, #first img, #first image, #first a[href^="javascript:"], #first a[href^="data:"]',
      )
      .count(),
    0,
  );
  assert.equal(await page.evaluate(() => globalThis.pwned), undefined);

  // The standalone diff draws host files with the same highlighter and no walkthrough.
  const diff = page.locator("#diff");
  await diff.locator('[data-theme="dark"] span[style*="color"]').first().waitFor();
  assert.equal(await diff.locator(".file-head").count(), 3);
  assert.ok(await diff.getByText("No content changes.", { exact: true }).count());
  assert.ok(await diff.getByText("Binary file — no diff to show.", { exact: true }).count());
  assert.equal(await diff.locator('script, img, image, b, a[href^="javascript:"]').count(), 0);
  await diff.getByRole("link", { name: "Open example.ts", exact: true }).click();
  await diff.getByRole("button", { name: "Open src/<b>hostile</b>.ts", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => globalThis.viewerFixture.openedFiles()), [
    "example.ts",
    "src/<b>hostile</b>.ts",
  ]);
  assert.deepEqual(await hostState(), before);

  // Memory marks stay local to the second viewer; the host persists the first one's marks.
  await page
    .locator('#second [data-balade-section="overview"]')
    .getByRole("button", { name: "Mark reviewed", exact: true })
    .click();
  assert.equal(await page.evaluate(() => globalThis.viewerFixture.readReview()), null);
  await page
    .locator('#first [data-balade-section="overview"]')
    .getByRole("button", { name: "Mark reviewed", exact: true })
    .click();
  await page.waitForFunction(() => globalThis.viewerFixture.readReview()?.sections.overview);

  // Root state classes must work without another viewer wrapper supplied by the host.
  await page.locator("#first").getByRole("button", { name: "Hide reviewed", exact: true }).click();
  const reviewedBody = '#first [data-balade-section="overview"] .section-body';
  assert.equal(
    await page.locator(reviewedBody).evaluate((element) => getComputedStyle(element).display),
    "none",
  );
  assert.notEqual(
    await page
      .locator('#second [data-balade-section="overview"] .section-body')
      .evaluate((element) => getComputedStyle(element).display),
    "none",
  );
  await page.locator("#first").getByRole("button", { name: "Show reviewed", exact: true }).click();
  assert.notEqual(
    await page.locator(reviewedBody).evaluate((element) => getComputedStyle(element).display),
    "none",
  );

  // A composed navigation observes only its own sections in the supplied scroll container.
  await page.locator("#composed nav").getByRole("link", { name: "Evidence", exact: true }).click();
  await page.waitForFunction(
    () => document.getElementById("active-section").textContent === "evidence",
  );
  await page.waitForFunction(() => document.getElementById("scroll-root").scrollTop > 0);
  assert.deepEqual(await hostState(), before);

  const first = page.locator("#first");
  await first.locator('[data-balade-section="evidence"] .file-head button').first().click();
  assert.equal(await first.locator("script, img, image").count(), 0);
  const passage = first.getByText("Select this passage to ask a question.", { exact: true });
  await passage.scrollIntoViewIfNeeded();
  await passage.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await first.getByRole("button", { name: "Ask agent", exact: true }).click();
  await first.locator("textarea").fill("Why is it safe?");
  await first.getByRole("button", { name: "Ask", exact: true }).click();
  await first.getByText("Pinned answer.", { exact: false }).first().waitFor();
  assert.equal(await page.locator("#second [data-qa-panel]").count(), 0);
  assert.equal(await page.evaluate(() => globalThis.viewerFixture.subscriptions()), 1);
  await page.evaluate(() => globalThis.viewerFixture.changeBehavior("failed"));
  await first.locator("textarea").fill("Fail this follow-up");
  await first.getByRole("button", { name: "Ask", exact: true }).click();
  await first
    .getByText("The agent could not answer this question. You can ask another follow-up.", {
      exact: true,
    })
    .waitFor();
  await page.evaluate(() => globalThis.viewerFixture.changeBehavior("generation"));
  await first.locator("textarea").fill("A changed generation");
  await first.getByRole("button", { name: "Ask", exact: true }).click();
  await first.getByText(/walkthrough changed/i).waitFor();
  assert.equal(await page.evaluate(() => globalThis.pwned), undefined);
  assert.deepEqual(await hostState(), before);

  // Compact controls remain in this viewer's visible area after scrolling.
  await first.locator("[data-qa-panel] header button").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await passage.scrollIntoViewIfNeeded();
  const bar = first.locator("[data-section-bar]");
  await bar.waitFor({ state: "visible" });
  const barBox = await bar.boundingBox();
  const viewerBox = await first.boundingBox();
  assert.ok(
    barBox && viewerBox && barBox.y >= 0 && barBox.y + barBox.height <= 845,
    JSON.stringify({
      barBox,
      viewerBox,
      overlay: await first.locator(".balade-overlay-viewport").boundingBox(),
    }),
  );
  assert.ok(
    barBox.x >= viewerBox.x && barBox.x + barBox.width <= viewerBox.x + viewerBox.width + 1,
  );
  await bar.locator("button[aria-expanded]").click();
  await first
    .locator("[data-section-sheet]")
    .getByRole("link", { name: "Evidence", exact: true })
    .click();
  await first.locator("[data-section-sheet]").waitFor({ state: "detached" });
  assert.deepEqual(await hostState(), before);

  await page.screenshot({
    path: process.env.BALADE_VIEWER_SCREENSHOT ?? "/tmp/balade-viewer.png",
    fullPage: false,
  });
  await page.evaluate(() => globalThis.viewerFixture.unmount());
  assert.equal(await page.evaluate(() => globalThis.viewerFixture.subscriptions()), 0);
  assert.deepEqual(violations, [], "CSP violations");
  assert.deepEqual(errors, [], "browser errors");
  assert.ok(
    requests.every((url) => url === `${origin}/` || url.startsWith(`${origin}/assets/`)),
    `Unexpected requests: ${requests.join(", ")}`,
  );

  // The standalone bundle owns its document canvas, including short index/error pages.
  const standalone = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await standalone.setContent(
    '<!doctype html><html><body><div id="root" class="balade-viewer">Short page</div></body></html>',
  );
  await standalone.addStyleTag({ path: join(packageRoot, "dist/export/app.css") });
  const canvas = await standalone.evaluate(() => {
    const root = document.getElementById("root");
    const rect = root.getBoundingClientRect();
    return {
      margin: getComputedStyle(document.body).margin,
      scheme: getComputedStyle(document.documentElement).colorScheme,
      background: getComputedStyle(root).backgroundColor,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  });
  assert.deepEqual(canvas, {
    margin: "0px",
    scheme: "dark",
    background: "rgb(12, 12, 13)",
    x: 0,
    y: 0,
    width: 1000,
    height: 800,
  });
  await standalone.close();
  console.log("viewer browser smoke passed");
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
