/** Data contract with models/export_web.py. Columnar arrays, index = person index. */
export interface PeopleData {
  n: number;
  id: string[];
  name: string[];
  by: (number | null)[];
  dy: (number | null)[];
  /** birth precision: 0 missing, 1 year-only, 2 full date, 3 coarser than year */
  bp: number[];
  /** bitmask, see FLAG */
  f: number[];
  /** country index into `countries`, -1 unknown */
  c: number[];
  countries: string[];
  /** gender index into `genders` */
  gd: number[];
  genders: string[];
  /** field community (-1 = none / other) */
  fc: number[];
  communities: { id: number; label: string; top_fields: string[]; people: number }[];
  /** descendants, descendant laureates, generation, pagerank percentile*1000 */
  d: number[];
  dl: number[];
  g: number[];
  pr: number[];
  /** image file name on Wikimedia Commons ("" if none) */
  img: string[];
  /** first major award year (null if none) */
  aw: (number | null)[];
}

export interface LayoutData {
  x: number[];
  y: number[];
}

export interface EdgesData {
  /** flat [advisor, student, advisor, student, ...] person indices */
  advised: number[];
  /** flat [advisor, student, score*1000, ...] */
  predicted: number[];
}

export const FLAG = {
  seed: 1,
  core: 2,
  laureate: 4,
  nobel: 8,
  conflict: 16,
  deathMissing: 32,
  quality: 64,
  image: 128,
  yearOnly: 256,
} as const;

export interface PersonDetail {
  desc?: string;
  wiki?: string;
  bd?: string | null;
  dd?: string | null;
  dp?: string;
  place?: string | null;
  bcountry?: string | null;
  cit?: string | null;
  gender?: string | null;
  awards: [string, number | null, 0 | 1][];
  inst: [string, number | null, number | null, "employer" | "educated", 0 | 1][];
  fields: string[];
  works: string[];
  quality: string[];
  predicted: { advisor: number; score: number; inst: string[]; fields: string[]; gap: number | null }[];
  sitelinks?: number;
}

export interface Meta {
  generated: string;
  counts: Record<string, number>;
  link_metrics: Record<string, Record<string, number>>;
  best_link_model: string;
  year_min: number;
  year_max: number;
  ask_api: string | null;
  story: Record<string, string | number>;
}
