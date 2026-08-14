/**
 * The single-file export document: one JS, one CSS, and the resolved payload
 * baked as `window.__BALADE__` ahead of the app. Pure string transforms.
 */

import type { Payload } from "../../contract/types.js";

const FAVICON_DATA_URI =
  "data:image/png;base64,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";

export interface ExportAssets {
  /** The export bundle's single entry chunk. */
  js: string;
  /** The export bundle's single stylesheet. */
  css: string;
}

export function exportHtml(payload: Payload, assets: ExportAssets): string {
  return [
    "<!doctype html>",
    `<html lang="${payload.lang}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<link rel="icon" type="image/png" sizes="64x64" href="${FAVICON_DATA_URI}">`,
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'\">",
    `<title>${escapeText(payload.title)}</title>`,
    `<style>${styleText(assets.css)}</style>`,
    "</head>",
    "<body>",
    '<div id="root"></div>',
    `<script>window.__BALADE__=${bake(payload)}</script>`,
    /* `import.meta` in the bundle: a module script, not a classic one. Inline,
       because a `src=` to a sibling file is exactly what this export is not. */
    `<script type="module">${scriptText(assets.js)}</script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/**
 * The payload as a JavaScript expression. Every `<` leaves as its JSON escape,
 * which settles `</script`, `<!--` and `<script` at once, whatever the prose
 * holds. The two line separators are legal in JSON and were not legal in a
 * JavaScript string before ES2019.
 */
function bake(value: Payload): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

/**
 * Code cannot be escaped the way data can, so the two sequences that end or
 * derail script data use escapes that preserve their JavaScript values:
 *
 * - `</script` can only sit inside a string, a template or a comment — a bare
 *   `/` would close a regular expression literal — and `\/` is `/` in all three.
 * - `<!--` opens the tokenizer's escaped state, where a later `<script>` makes
 *   the closing tag stop closing. `\x3c` is `<` in strings, templates and
 *   regular expressions, including expressions with the `/u` flag.
 */
function scriptText(js: string): string {
  return js.replaceAll(/<\/script/gi, "<\\/script").replaceAll("<!--", "\\x3c!--");
}

/** `<style>` is raw text: only its own end tag closes it. */
function styleText(css: string): string {
  return css.replaceAll(/<\/style/gi, "<\\/style");
}

const escapeText = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
