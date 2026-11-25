export function fmtYear(y: number | null | undefined): string {
  if (y === null || y === undefined) return "?";
  return y < 0 ? `${-y} BCE` : String(y);
}

export function fmtLife(by: number | null | undefined, dy: number | null | undefined): string {
  if (by == null && dy == null) return "dates unknown";
  const b = fmtYear(by);
  if (dy == null) return by != null && by < 1910 ? `${b}–?` : `b. ${b}`;
  return `${b}–${fmtYear(dy)}`;
}

export const PRECISION_LABEL: Record<number, string> = {
  0: "date missing",
  1: "year only",
  2: "full date",
  3: "approximate",
};

export function fmtNum(n: number, digits = 0): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function fmtPct(x: number, digits = 0): string {
  return `${(x * 100).toFixed(digits)}%`;
}

/** Commons thumbnail URL for a file name. */
export function thumbUrl(file: string, width = 96): string {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${width}`;
}

export function wikidataUrl(qid: string): string {
  return `https://www.wikidata.org/wiki/${qid}`;
}

export function initials(name: string): string {
  const parts = name
    .replace(/\(.*?\)/g, "")
    .trim()
    .split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
