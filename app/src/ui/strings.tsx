import { createContext, useContext, type ReactNode } from "react";
import { dictionaries, stringsFor, type Lang, type Strings } from "../i18n";

const StringsContext = createContext<Strings>(dictionaries.en);

export function StringsProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <StringsContext.Provider value={stringsFor(lang)}>{children}</StringsContext.Provider>;
}

export const useStrings = (): Strings => useContext(StringsContext);
