import { FLAG, type PeopleData } from "./types";

export const YEAR_MIN = -600;
export const YEAR_MAX = 2025;

export interface Filters {
  /** time slider; people born after `year` are hidden */
  year: number;
  core: boolean;
  laureates: boolean;
  field: number | null; // community id
  country: string | null;
  gender: string | null;
  predicted: boolean;
}

export const DEFAULT_FILTERS: Filters = {
  year: YEAR_MAX,
  core: false,
  laureates: false,
  field: null,
  country: null,
  gender: null,
  predicted: false,
};

/** Serialise only non-default values so URLs stay short and shareable. */
export function filtersToParams(f: Filters, base?: URLSearchParams): URLSearchParams {
  const p = new URLSearchParams(base);
  const set = (k: string, v: string | null) => (v === null ? p.delete(k) : p.set(k, v));
  set("t", f.year !== YEAR_MAX ? String(f.year) : null);
  set("core", f.core ? "1" : null);
  set("laur", f.laureates ? "1" : null);
  set("field", f.field !== null ? String(f.field) : null);
  set("country", f.country);
  set("gender", f.gender);
  set("pred", f.predicted ? "1" : null);
  return p;
}

export function paramsToFilters(p: URLSearchParams): Filters {
  const num = (k: string) => {
    const v = p.get(k);
    if (v === null || v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const t = num("t");
  return {
    year: t === null ? YEAR_MAX : Math.min(YEAR_MAX, Math.max(YEAR_MIN, Math.round(t))),
    core: p.get("core") === "1",
    laureates: p.get("laur") === "1",
    field: num("field"),
    country: p.get("country"),
    gender: p.get("gender"),
    predicted: p.get("pred") === "1",
  };
}

export function activeFilterCount(f: Filters): number {
  return (
    Number(f.core) +
    Number(f.laureates) +
    Number(f.field !== null) +
    Number(f.country !== null) +
    Number(f.gender !== null) +
    Number(f.year !== YEAR_MAX)
  );
}

/**
 * Visibility mask. People with unknown birth year are shown only at the end of the
 * timeline (we can't place them in time), never hidden by the other filters' absence.
 */
export function computeVisible(
  people: Pick<PeopleData, "n" | "by" | "f" | "fc" | "c" | "countries" | "gd" | "genders">,
  f: Filters,
): Uint8Array {
  const out = new Uint8Array(people.n);
  const countryIdx = f.country === null ? -2 : people.countries.indexOf(f.country);
  const genderIdx = f.gender === null ? -2 : people.genders.indexOf(f.gender);
  for (let i = 0; i < people.n; i++) {
    const by = people.by[i];
    if (by === null ? f.year < YEAR_MAX : by > f.year) continue;
    const flags = people.f[i];
    if (f.core && !(flags & FLAG.core)) continue;
    if (f.laureates && !(flags & FLAG.laureate)) continue;
    if (f.field !== null && people.fc[i] !== f.field) continue;
    if (countryIdx !== -2 && people.c[i] !== countryIdx) continue;
    if (genderIdx !== -2 && people.gd[i] !== genderIdx) continue;
    out[i] = 1;
  }
  return out;
}
