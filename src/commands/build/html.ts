/**
 * The single-file export document: one JS, one CSS, and the resolved payload
 * baked as `window.__BALADE__` ahead of the app. Pure string transforms.
 */

import type { Payload } from "../../contract/types.js";

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
function bake(value: unknown): string {
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
