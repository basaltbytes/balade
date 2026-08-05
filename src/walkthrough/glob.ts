/** Path globs for the `files` filter: `*`, `**`, `?`, and `{a,b}` alternatives. */

function globToRegExp(pattern: string): RegExp {
  let out = "";
  let braces = 0;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === undefined) continue;
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        i++;
        if (pattern[i + 1] === "/") {
          i++;
          out += "(?:.*/)?";
        } else out += ".*";
      } else out += "[^/]*";
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      continue;
    }
    if (ch === "{") {
      braces++;
      out += "(?:";
      continue;
    }
    if (ch === "}" && braces > 0) {
      braces--;
      out += ")";
      continue;
    }
    if (ch === "," && braces > 0) {
      out += "|";
      continue;
    }
    out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

/* One compile per pattern: the `files` filter runs the same glob over every PR file. */
const compiled = new Map<string, RegExp>();

export function matchesGlob(path: string, pattern: string): boolean {
  let re = compiled.get(pattern);
  if (re === undefined) {
    re = globToRegExp(pattern);
    compiled.set(pattern, re);
  }
  return re.test(path);
}
