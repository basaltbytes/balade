/* Payload block lookups shared by the compile and preset suites. */

import type { Block, Payload } from "../../src/payload/types.js";

export function firstBlock<K extends Block["b"]>(
  payload: Payload,
  sectionId: string,
  kind: K,
): Extract<Block, { b: K }> {
  const section = payload.sections.find((entry) => entry.id === sectionId);
  if (section === undefined) throw new Error(`no section ${sectionId}`);
  const block = section.blocks.find((entry) => entry.b === kind);
  if (block === undefined) throw new Error(`no ${kind} block in ${sectionId}`);
  return block as Extract<Block, { b: K }>;
}
