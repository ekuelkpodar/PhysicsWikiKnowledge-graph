/**
 * Field-community palette. Order validated with the dataviz validator against our own
 * surfaces (dark #0b0f14, light #f4eee1): passes lightness, chroma, adjacent CVD and
 * normal-vision floors in both modes. Yellow is omitted because gold is reserved for
 * laureates. Six hues in a scatter is beyond the all-pairs cap, so identity is never
 * colour-alone: legend + tooltip name the field, and the field filter isolates one.
 * Light mode has three sub-3:1 slots -> relief via legend and data tables.
 */
export const COMMUNITY_DARK = ["#338ced", "#e76624", "#00a888", "#9887ef", "#e24d8b", "#0aac23"];
export const COMMUNITY_LIGHT = ["#257de0", "#f47230", "#00b894", "#6a4ce2", "#ee7fac", "#008a17"];
export const OTHER_DARK = "#5b6474";
export const OTHER_LIGHT = "#a49c8a";
export const GOLD_DARK = "#e0b55a";
export const GOLD_LIGHT = "#a8770f";
export const CYAN_DARK = "#5fd4e6";
export const CYAN_LIGHT = "#0b6f80";

export function communityColor(c: number, dark: boolean): string {
  const pal = dark ? COMMUNITY_DARK : COMMUNITY_LIGHT;
  return c >= 0 && c < pal.length ? pal[c] : dark ? OTHER_DARK : OTHER_LIGHT;
}

/** Categorical series for charts (same validated order). */
export function seriesColor(i: number, dark: boolean): string {
  const pal = dark ? COMMUNITY_DARK : COMMUNITY_LIGHT;
  return pal[i % pal.length];
}
