/** Scope generated utilities and dependency styles before Vite minifies them. */
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

export function scopeCss(css: string): string {
  const root = postcss.parse(css);
  const initialProperties = postcss.rule({
    selector: ".balade-viewer, .balade-viewer *, .balade-viewer ::before, .balade-viewer ::after",
  });
  root.walkAtRules("property", (rule) => {
    rule.walkDecls("initial-value", (declaration) => {
      initialProperties.append({ prop: rule.params, value: declaration.value });
    });
    rule.remove();
  });
  root.append(initialProperties);
  root.walkAtRules("keyframes", (rule) => {
    const name = rule.params;
    rule.params = `balade-${name}`;
    root.walkDecls((declaration) => {
      if (declaration.prop.includes("animation") || declaration.prop.startsWith("--animate-")) {
        declaration.value = declaration.value.replace(
          new RegExp(`(?<![-\\w])${name}(?![-\\w])`, "g"),
          `balade-${name}`,
        );
      }
    });
  });
  root.walkRules((rule) => {
    if (
      rule.parent?.type === "rule" ||
      (rule.parent?.type === "atrule" && rule.parent.name.endsWith("keyframes"))
    )
      return;
    rule.selector = selectorParser((selectors) => {
      selectors.each((selector) => {
        const first = selector.first;
        if (first && [":root", ":host", "html", "body"].includes(first.value ?? "")) {
          first.replaceWith(selectorParser.className({ value: "balade-viewer" }));
        } else if (first?.value !== "balade-viewer") {
          selector.prepend(selectorParser.combinator({ value: " " }));
          selector.prepend(selectorParser.className({ value: "balade-viewer" }));
        }
      });
    }).processSync(rule.selector);
  });
  // Tailwind defaults and utilities must never read a host's --color-* or --tw-* tokens.
  return root
    .toString()
    .replace(
      /--(color|font|radius|spacing|text|ease|animate|tw|default|breakpoint|container|tracking|leading|blur|shadow|drop-shadow|inset-shadow|perspective|aspect|transition)(?=[-:)\s])/g,
      "--balade-$1",
    );
}
