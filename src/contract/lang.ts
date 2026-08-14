/**
 * Highlight language ids for the renderer (shiki `github-dark-default`).
 * The payload never carries tokens, only this id.
 */

import { fileName } from "./paths.js";

const BY_EXTENSION = new Map(
  Object.entries({
  bash: "bash",
  c: "c",
  cfg: "ini",
  cjs: "javascript",
  conf: "ini",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  csv: "csv",
  go: "go",
  graphql: "graphql",
  h: "c",
  hpp: "cpp",
  htm: "html",
  html: "html",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  jsonc: "jsonc",
  jsx: "jsx",
  kt: "kotlin",
  less: "less",
  lua: "lua",
  md: "markdown",
  mdx: "mdx",
  mjs: "javascript",
  mts: "typescript",
  php: "php",
  po: "po",
  pot: "po",
  ps1: "powershell",
  py: "python",
  rb: "ruby",
  rs: "rust",
  scss: "scss",
  sh: "bash",
  sql: "sql",
  svg: "xml",
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  txt: "text",
  vue: "vue",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
  }),
);

const BY_FILENAME = new Map(
  Object.entries({
  ".gitignore": "text",
  dockerfile: "dockerfile",
  makefile: "makefile",
  "requirements.txt": "text",
  }),
);

export function langOf(path: string): string {
  const name = fileName(path).toLowerCase();
  const byName = BY_FILENAME.get(name);
  if (byName !== undefined) return byName;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "text";
  return BY_EXTENSION.get(name.slice(dot + 1)) ?? "text";
}
