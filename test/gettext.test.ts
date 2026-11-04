import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { countEntries, parsePo, poLanguage } from "../src/walkthrough/gettext.js";

const poEntries = Arbitrary.array(
  Arbitrary.all([
    Arbitrary.schema(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(40))),
    Arbitrary.schema(Schema.String.check(Schema.isMaxLength(60))),
  ]),
  { maxLength: 20 },
  /* Catalog ids are unique; the last duplicate wins, as it does in `new Map`. */
).pipe(Arbitrary.map((entries) => [...new Map(entries)]));

describe("gettext", () => {
  const before = `msgid ""
msgstr "header"

msgid "Pool item"
msgstr "Élément du pool"

msgid "Gone"
msgstr "Parti"
`;
  const after = `msgid ""
msgstr "header"

msgid "Pool item"
msgstr "Élément de pool"

msgid "Placed"
msgstr "Placé"
`;

  it.prop("round-trips generated catalogs", [poEntries], ([entries]) => {
    const source = entries
      .map(([id, value]) => `msgid ${JSON.stringify(id)}\nmsgstr ${JSON.stringify(value)}\n`)
      .join("\n");
    expect(parsePo(source)).toEqual(new Map(entries));
  });

  it("decodes escaped quoted strings", () => {
    const id = 'Say "hello" from C:\\tmp';
    const value = "First line\nSecond\tline";
    const source = `msgid ${JSON.stringify(id)}\nmsgstr ${JSON.stringify(value)}\n`;
    expect(parsePo(source).get(id)).toBe(value);
  });

  it("reads msgid/msgstr pairs and skips the header", () => {
    expect([...parsePo(before).keys()]).toEqual(["Pool item", "Gone"]);
  });

  it("joins multi-line strings", () => {
    const entries = parsePo('msgid "Long "\n"label"\nmsgstr "Étiquette "\n"longue"\n');
    expect(entries.get("Long label")).toBe("Étiquette longue");
  });

  it("counts new, updated and removed entries", () => {
    expect(countEntries(before, after)).toEqual({ new: 1, updated: 1, removed: 1 });
    expect(countEntries(null, after)).toEqual({ new: 2 });
    expect(countEntries(before, before)).toEqual({});
  });

  it("reads the language from the file name", () => {
    expect(poLanguage("i18n/fr.po")).toBe("fr");
    expect(poLanguage("i18n/acme.pot")).toBeNull();
  });
});
