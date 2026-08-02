/**
 * In-tree preset registry, keyed by preset name. External plugin loading
 * is ruled out of v1, so this map is the whole extension surface.
 */

import type { Preset, PresetTag } from "./types.js";
import { odooPreset } from "./odoo.js";

const REGISTRY: ReadonlyMap<string, Preset> = new Map([[odooPreset.name, odooPreset]]);

export function getPreset(name: string): Preset | undefined {
  return REGISTRY.get(name);
}

export function presetNames(): string[] {
  return [...REGISTRY.keys()].sort();
}

function allPresets(): Preset[] {
  return [...REGISTRY.values()];
}

/** The preset a tag name belongs to, by prefix — used to explain `o-` tags. */
export function presetOfTag(tag: string): Preset | undefined {
  return allPresets().find((preset) => tag.startsWith(preset.prefix));
}

export function presetTag(preset: Preset | undefined, tag: string): PresetTag | undefined {
  return preset?.tags[tag];
}

/** Every preset tag known to this build, so the schema validates them all. */
export function allPresetSchemas(): Record<string, PresetTag["schema"]> {
  const out: Record<string, PresetTag["schema"]> = {};
  for (const preset of allPresets()) {
    for (const [name, tag] of Object.entries(preset.tags)) out[name] = tag.schema;
  }
  return out;
}
