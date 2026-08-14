/** In-tree preset registry, keyed by preset name. */

import type { Preset, PresetTag } from "./types.js";
import { odooPreset } from "./odoo.js";

const REGISTRY: ReadonlyMap<string, Preset> = new Map([[odooPreset.name, odooPreset]]);
const PRESETS: readonly Preset[] = [...REGISTRY.values()];

export function getPreset(name: string): Preset | undefined {
  return REGISTRY.get(name);
}

export function presetNames(): string[] {
  return [...REGISTRY.keys()].sort();
}

/** The preset a tag name belongs to, by prefix — used to explain `o-` tags. */
export function presetOfTag(tag: string): Preset | undefined {
  return PRESETS.find((preset) => tag.startsWith(preset.prefix));
}

/** Every preset tag known to this build, so the schema validates them all. */
export function allPresetSchemas() {
  return Object.fromEntries(
    PRESETS.flatMap((preset) =>
      Object.entries(preset.tags).map(([name, tag]): [string, PresetTag["schema"]] => [
        name,
        tag.schema,
      ]),
    ),
  );
}
