import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// WCAG AA: every text token must reach 4.5:1 on bg, surface and surface-2 in both themes.
const css = readFileSync(path.resolve(process.cwd(), "src/index.css"), "utf8");
function tokens(block: string) {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)) out[m[1]] = m[2];
  return out;
}
const light = tokens(css.match(/:root\s*{([^}]*)}/)![1]);
const dark = tokens(css.match(/\.dark\s*{([^}]*)}/)![1]);
const lum = (hex: string) => {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe.each([
  ["light", light],
  ["dark", dark],
])("%s theme contrast", (_, t) => {
  for (const fg of ["text", "muted", "gold", "cyan", "danger"])
    for (const bg of ["bg", "surface", "surface-2"])
      it(`${fg} on ${bg} >= 4.5`, () => expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5));
});
