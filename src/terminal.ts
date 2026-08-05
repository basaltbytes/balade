/** Terminal text is untrusted at the process edge: strip controls before writing it. */

import { stripVTControlCharacters } from "node:util";

export function sanitizeTerminalText(value: string): string {
  let safe = "";
  for (const character of stripVTControlCharacters(value)) {
    const point = character.codePointAt(0);
    if (
      point === undefined ||
      point === 9 ||
      point === 10 ||
      point === 13 ||
      (point >= 32 && (point < 127 || point > 159))
    ) {
      safe += character;
    }
  }
  return safe;
}

export function writeStdout(value: string): void {
  process.stdout.write(sanitizeTerminalText(value));
}

export function writeStderr(value: string): void {
  process.stderr.write(sanitizeTerminalText(value));
}
