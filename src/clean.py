"""Clean the raw Wikidata SPARQL export into one row per person.

Input : data/raw/physicists.csv   (12,255 rows, one per SPARQL binding combination)
Output: data/processed/physicists_clean.csv  (one row per QID)

Rules (see docs/DECISIONS.md):
* QID is taken from the entity URI, never from `tablescraper-selected-row`.
* "1 January YYYY" is treated as year precision. It is never a real date.
* "... BCE" years are stored as negative astronomical-ish years (-287 for 287 BCE).
* When a person has several birth/death statements we keep the most precise one.
  Ties go to the most frequent value, then the earliest, and we raise a conflict flag.
* No death date + born before 1910 => `death_missing_suspect` (missing, NOT alive).
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw/physicists.csv"
OUT = ROOT / "data/processed/physicists_clean.csv"

MONTHS = {
    m: i
    for i, m in enumerate(
        [
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December",
        ],
        start=1,
    )
}
DATE_RE = re.compile(r"^\s*(\d{1,2})\s+([A-Z][a-z]+)\s+(\d{1,4})(\s+BCE)?\s*$")
QID_RE = re.compile(r"(Q\d+)\s*$")
SUSPECT_MISSING_DEATH_BEFORE = 1910
MAX_LIFESPAN = 110


@dataclass(frozen=True)
class ParsedDate:
    year: int | None
    month: int | None
    day: int | None
    precision: str  # "day" | "year" | "missing" | "unparsed"

    @property
    def iso(self) -> str | None:
        if self.precision != "day" or self.year is None:
            return None
        sign = "-" if self.year < 0 else ""
        return f"{sign}{abs(self.year):04d}-{self.month:02d}-{self.day:02d}"


def parse_date(text: str | float | None) -> ParsedDate:
    """Parse '6 February 1941' / '1 January 0287 BCE' / '' into a ParsedDate."""
    if text is None or (isinstance(text, float) and pd.isna(text)) or str(text).strip() == "":
        return ParsedDate(None, None, None, "missing")
    m = DATE_RE.match(str(text))
    if not m or m.group(2) not in MONTHS:
        return ParsedDate(None, None, None, "unparsed")
    day, month, year = int(m.group(1)), MONTHS[m.group(2)], int(m.group(3))
    if m.group(4):
        year = -year
    # Wikidata serialises year-precision values as 1 January YYYY.
    if day == 1 and month == 1:
        return ParsedDate(year, None, None, "year")
    return ParsedDate(year, month, day, "day")


def qid_from_uri(uri: str) -> str | None:
    m = QID_RE.search(str(uri))
    return m.group(1) if m else None


_PREC_RANK = {"day": 3, "year": 2, "unparsed": 1, "missing": 0}


def pick_best(values: list[str]) -> tuple[ParsedDate, bool, int]:
    """Choose one date from several raw statements.

    Returns (chosen, has_conflict, n_distinct_nonmissing).
    Conflicts are flagged only between distinct non-missing statements. A year-only
    statement that agrees with a day-precision one in the same year is not a conflict.
    """
    parsed = [parse_date(v) for v in values]
    present = [p for p in parsed if p.precision in ("day", "year")]
    distinct = {(p.year, p.month, p.day) for p in present}
    if not present:
        any_unparsed = any(p.precision == "unparsed" for p in parsed)
        return ParsedDate(None, None, None, "unparsed" if any_unparsed else "missing"), False, 0
    counts: dict[tuple, int] = {}
    for p in present:
        counts[(p.year, p.month, p.day)] = counts.get((p.year, p.month, p.day), 0) + 1
    best = sorted(
        present,
        key=lambda p: (-_PREC_RANK[p.precision], -counts[(p.year, p.month, p.day)], p.year),
    )[0]
    years = {p.year for p in present}
    day_values = {(p.year, p.month, p.day) for p in present if p.precision == "day"}
    conflict = len(years) > 1 or len(day_values) > 1
    return best, conflict, len(distinct)


def name_from_row(label: str, wiki_url: str, qid: str) -> str:
    if label and not re.fullmatch(r"Q\d+", label):
        return label
    if wiki_url:
        title = wiki_url.rstrip("/").rsplit("/", 1)[-1]
        from urllib.parse import unquote

        return unquote(title).replace("_", " ")
    return qid


def clean(raw: pd.DataFrame) -> pd.DataFrame:
    raw = raw.fillna("")
    raw = raw.assign(qid=raw["explore href"].map(qid_from_uri))
    raw = raw[raw["qid"].notna()]
    rows = []
    for qid, g in raw.groupby("qid", sort=False):
        birth, b_conf, b_n = pick_best(g["tablescraper-selected-row 2"].tolist())
        death, d_conf, d_n = pick_best(g["tablescraper-selected-row 3"].tolist())
        labels = [v for v in g["tablescraper-selected-row"] if v and not re.fullmatch(r"Q\d+", v)]
        wiki = next((v for v in g["item-link href 2"] if v), "")
        rows.append(
            {
                "qid": qid,
                "name_raw": name_from_row(labels[0] if labels else "", wiki, qid),
                "wikipedia_url": wiki,
                "birth_year": birth.year,
                "birth_month": birth.month,
                "birth_day": birth.day,
                "birth_date": birth.iso,
                "birth_precision": birth.precision,
                "death_year": death.year,
                "death_month": death.month,
                "death_day": death.day,
                "death_date": death.iso,
                "death_precision": death.precision,
                "n_raw_rows": len(g),
                "birth_conflict": b_conf,
                "death_conflict": d_conf,
                "n_birth_values": b_n,
                "n_death_values": d_n,
            }
        )
    df = pd.DataFrame(rows)
    for c in ["birth_year", "birth_month", "birth_day", "death_year", "death_month", "death_day"]:
        df[c] = df[c].astype("Int64")
    df["has_conflict"] = df["birth_conflict"] | df["death_conflict"]
    # Any person who appeared in >1 raw SPARQL binding (the "275" in the brief).
    df["multi_statement"] = df["n_raw_rows"] > 1
    df["death_missing_suspect"] = df["death_year"].isna() & (
        df["birth_year"] < SUSPECT_MISSING_DEATH_BEFORE
    ).fillna(False)
    lifespan = df["death_year"] - df["birth_year"]
    df["lifespan"] = lifespan
    df["lifespan_implausible"] = ((lifespan < 0) | (lifespan > MAX_LIFESPAN)).fillna(False)
    # Status for survival analysis: alive only if no death AND plausibly alive.
    df["vital_status"] = "dead"
    df.loc[df["death_year"].isna() & ~df["death_missing_suspect"], "vital_status"] = (
        "presumed_alive"
    )
    df.loc[df["death_missing_suspect"], "vital_status"] = "death_missing"
    df.loc[df["birth_year"].isna() & df["death_year"].isna(), "vital_status"] = "unknown"
    return df


def main() -> int:
    raw = pd.read_csv(RAW, dtype=str, keep_default_na=False)
    df = clean(raw)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT, index=False)
    print(
        f"raw rows={len(raw):,}  people={len(df):,}  "
        f"multi-statement={int(df.multi_statement.sum())}  genuine conflicts={int(df.has_conflict.sum())}  "
        f"year-only births={int((df.birth_precision == 'year').sum())}  "
        f"no death={int(df.death_year.isna().sum())}  "
        f"suspect missing death={int(df.death_missing_suspect.sum())}  "
        f"BCE births={int((df.birth_year < 0).sum())}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
