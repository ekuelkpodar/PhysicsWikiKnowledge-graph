"""Model 4: migration flows, birth country -> employer country, by decade.

Each (person, employer) edge contributes one move dated by the employment start year
(imputed as birth+27 when Wikidata has no start qualifier). Countries are today's
borders (see DECISIONS.md). Outputs per-decade Sankey links, great-circle arc
endpoints and automatically detected emigration shocks, plus the two curated windows
from the brief (1933-45, post-1991).
"""

from __future__ import annotations

import sys

import numpy as np
import pandas as pd

from models.common import employment_spans, persons, table, write_json

TOP_N = 14
SOVIET = {
    "Russia",
    "Ukraine",
    "Belarus",
    "Georgia",
    "Armenia",
    "Azerbaijan",
    "Kazakhstan",
    "Uzbekistan",
    "Latvia",
    "Lithuania",
    "Estonia",
    "Moldova",
    "Kyrgyzstan",
    "Tajikistan",
    "Turkmenistan",
}
CENTRAL_EU = {"Germany", "Austria", "Hungary", "Czech Republic", "Poland"}


def moves() -> pd.DataFrame:
    p = persons().set_index("qid")
    inst = table("nodes_institution").set_index("qid")
    e = employment_spans()
    e = e[e.person.isin(p.index[p.is_seed])]
    df = pd.DataFrame(
        {
            "person": e.person,
            "institution": e.institution,
            "year": e.start.astype(float).round().astype("Int64"),
            "year_inferred": e.start_year.isna().to_numpy(),
            "from_country": e.person.map(p.birth_country),
            "from_lat": e.person.map(p.birth_lat),
            "from_lon": e.person.map(p.birth_lon),
            "to_country": e.institution.map(inst.country),
            "to_lat": e.institution.map(inst.lat),
            "to_lon": e.institution.map(inst.lon),
            "core": e.person.map(p.is_core_physicist).fillna(False).astype(bool),
            "laureate": e.person.map(p.is_laureate).fillna(False).astype(bool),
        }
    )
    df = df.dropna(subset=["from_country", "to_country", "year"])
    df["decade"] = (df.year // 10 * 10).astype(int)
    df["moved"] = df.from_country != df.to_country
    return df.reset_index(drop=True)


def detect_shocks(df: pd.DataFrame, min_total=60, min_decade=15) -> list[dict]:
    """Per origin country, emigration share by decade vs that country's own median."""
    first = df.sort_values("year").drop_duplicates(["person", "decade"])
    out = []
    for origin, g in first.groupby("from_country"):
        if len(g) < min_total:
            continue
        by_dec = g.groupby("decade").agg(n=("moved", "size"), moved=("moved", "sum"))
        by_dec = by_dec[by_dec.n >= min_decade]
        if len(by_dec) < 4:
            continue
        share = by_dec.moved / by_dec.n
        base = share.median()
        mad = (share - base).abs().median() + 0.03
        for dec, s in share.items():
            z = (s - base) / mad
            if z >= 3 and s - base >= 0.15:
                dest = g[(g.decade == dec) & g.moved].to_country.value_counts().head(3).to_dict()
                out.append(
                    {
                        "origin": origin,
                        "decade": int(dec),
                        "share_abroad": float(s),
                        "baseline": float(base),
                        "n": int(by_dec.at[dec, "n"]),
                        "z": float(z),
                        "top_destinations": dest,
                    }
                )
    return sorted(out, key=lambda r: -r["z"])


def window_stat(df, origins: set, lo: int, hi: int, base_lo: int, base_hi: int) -> dict:
    first = df.sort_values("year").drop_duplicates(["person", "decade"])
    sub = first[first.from_country.isin(origins)]
    win = sub[sub.year.between(lo, hi)]
    base = sub[sub.year.between(base_lo, base_hi)]
    dest = win[win.moved].to_country.value_counts().head(5).to_dict()
    return {
        "window": [lo, hi],
        "baseline_window": [base_lo, base_hi],
        "share_abroad": float(win.moved.mean()) if len(win) else None,
        "baseline_share_abroad": float(base.moved.mean()) if len(base) else None,
        "n": int(len(win)),
        "n_baseline": int(len(base)),
        "top_destinations": dest,
        "emigrants": int(win.moved.sum()),
    }


def main() -> int:
    df = moves()
    top = pd.concat([df.from_country, df.to_country]).value_counts().head(TOP_N).index.tolist()
    norm = lambda c: c if c in top else "Other"  # noqa: E731
    df["from_g"] = df.from_country.map(norm)
    df["to_g"] = df.to_country.map(norm)
    uniq = df.drop_duplicates(["person", "to_country", "decade"])
    sankey = {}
    for dec, g in uniq.groupby("decade"):
        if dec < 1800:
            continue
        links = g.groupby(["from_g", "to_g"]).size().reset_index(name="value")
        sankey[int(dec)] = links.rename(columns={"from_g": "source", "to_g": "target"}).to_dict(
            "records"
        )
    # cumulative-by-era Sankeys for a compact default view
    eras = {
        "1800-1899": (1800, 1899),
        "1900-1932": (1900, 1932),
        "1933-1945": (1933, 1945),
        "1946-1990": (1946, 1990),
        "1991-2025": (1991, 2025),
    }
    sankey_eras = {}
    for k, (lo, hi) in eras.items():
        g = uniq[uniq.year.between(lo, hi)]
        links = g.groupby(["from_g", "to_g"]).size().reset_index(name="value")
        sankey_eras[k] = links.rename(columns={"from_g": "source", "to_g": "target"}).to_dict(
            "records"
        )

    arcs = df[df.moved & df[["from_lat", "from_lon", "to_lat", "to_lon"]].notna().all(axis=1)]
    arcs = arcs.drop_duplicates(["person", "institution"])
    inst = table("nodes_institution").set_index("qid")
    arc_rows = [
        [
            r.person,
            int(r.year),
            round(r.from_lon, 3),
            round(r.from_lat, 3),
            round(r.to_lon, 3),
            round(r.to_lat, 3),
            r.from_country,
            r.to_country,
            int(r.laureate),
            int(r.core),
            inst.label.get(r.institution),
        ]
        for r in arcs.itertuples()
    ]
    shocks = detect_shocks(df)
    curated = {
        "nazi_era": {
            "label": "1933–45: flight from Nazi-controlled Central Europe",
            **window_stat(df, CENTRAL_EU, 1933, 1945, 1900, 1932),
        },
        "post_soviet": {
            "label": "Post-1991: the post-Soviet brain drain",
            **window_stat(df, SOVIET, 1991, 2010, 1960, 1990),
        },
    }
    # Country nodes with coordinates for the map legend
    cty = table("nodes_country")
    by_decade_total = (
        df.drop_duplicates(["person", "decade"])
        .groupby("decade")
        .agg(n=("moved", "size"), share_abroad=("moved", "mean"))
    )
    payload = {
        "top_countries": top,
        "sankey_by_decade": sankey,
        "sankey_by_era": sankey_eras,
        "arc_columns": [
            "person",
            "year",
            "from_lon",
            "from_lat",
            "to_lon",
            "to_lat",
            "from_country",
            "to_country",
            "laureate",
            "core",
            "institution",
        ],
        "arcs": arc_rows,
        "shocks_detected": shocks[:20],
        "curated_windows": curated,
        "share_abroad_by_decade": {
            int(k): {"n": int(v.n), "share": float(v.share_abroad)}
            for k, v in by_decade_total.iterrows()
            if k >= 1800
        },
        "countries": cty[["label", "iso3", "lat", "lon"]]
        .dropna(subset=["label"])
        .to_dict("records"),
        "notes": {
            "start_year_imputed_share": float(df.year_inferred.mean()),
            "n_moves": int(len(df)),
            "n_cross_border": int(df.moved.sum()),
            "n_people": int(df.person.nunique()),
        },
    }
    write_json("migration.json", payload)
    print(
        f"migration: moves={len(df):,} cross-border={int(df.moved.sum()):,} arcs={len(arc_rows):,} "
        f"imputed-start={df.year_inferred.mean():.0%}"
    )
    for k, v in curated.items():
        print(
            f"  {k}: {v['share_abroad']} vs baseline {v['baseline_share_abroad']} n={v['n']} "
            f"dest={v['top_destinations']}"
        )
    for s in shocks[:8]:
        print(
            f"  shock {s['origin']} {s['decade']}s: {s['share_abroad']:.0%} vs {s['baseline']:.0%}"
            f" (n={s['n']}) -> {s['top_destinations']}"
        )
    _ = np
    return 0


if __name__ == "__main__":
    sys.exit(main())
