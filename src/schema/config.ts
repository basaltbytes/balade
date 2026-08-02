/**
 * The Markdoc config: the core catalog plus every registered preset tag.
 * Preset tags always validate; using one without activating its preset is a
 * `preset-tag-inactive` error raised by the compiler, not a schema error.
 */

import type { Config } from "@markdoc/markdoc";
import { allPresetSchemas } from "../preset/registry.js";
import { CORE_TAGS } from "./tags.js";

export const MARKDOC_CONFIG: Config = {
  tags: { ...CORE_TAGS, ...allPresetSchemas() },
  /* The format bans expressions: no variables, no functions. */
  variables: {},
  functions: {},
};
