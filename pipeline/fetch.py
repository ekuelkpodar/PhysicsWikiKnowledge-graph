"""Fetch all enrichment data from Wikidata (cached) into data/interim/*.parquet."""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

from pipeline.wikidata import load_template, qid, run_batched

ROOT = Path(__file__).resolve().parents[1]
CLEAN = ROOT / "data/processed/physicists_clean.csv"
INTERIM = ROOT / "data/interim"

GENEALOGY_PROPS = {"P184", "P185", "P1066"}
ENTITY_PROPS = {"P27", "P19", "P101", "P800", "P21", "P106", "P166", "P108", "P69", "P737"}
EXPANSION_HOPS = 2  # how far to follow advisor/student links beyond the seed


def _simple(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows, columns=["item", "prop", "o"])
    df["item"] = df["item"].map(qid)
    df["prop"] = df["prop"].map(lambda p: p.rsplit("/", 1)[-1])
    return df


def _qualified(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows, columns=["item", "prop", "o", "time", "start", "end"])
    df["item"] = df["item"].map(qid)
    return df


def _is_entity(v: str) -> bool:
    return isinstance(v, str) and v.startswith("http://www.wikidata.org/entity/Q")


def main() -> int:
    INTERIM.mkdir(parents=True, exist_ok=True)
    seed = pd.read_csv(CLEAN, usecols=["qid"])["qid"].tolist()
    print(f"seed people: {len(seed):,}")

    t_edges, t_qual, t_meta = (
        load_template("02_edges.rq"),
        load_template("03_award_dates.rq"),
        load_template("04_person_meta.rq"),
    )

    # --- people: seed + genealogy expansion ---------------------------------
    people = {q: 0 for q in seed}
    frontier = list(seed)
    edges_all, qual_all, meta_all = [], [], []
    for hop in range(EXPANSION_HOPS + 1):
        print(f"hop {hop}: {len(frontier):,} people")
        e = _simple(run_batched(t_edges, frontier, 400, f"edges h{hop}"))
        q = _qualified(run_batched(t_qual, frontier, 300, f"qualified h{hop}"))
        m = pd.DataFrame(run_batched(t_meta, frontier, 400, f"meta h{hop}"))
        e["hop"] = hop
        q["hop"] = hop
        edges_all.append(e)
        qual_all.append(q)
        meta_all.append(m)
        if hop == EXPANSION_HOPS:
            break
        gen = e[e.prop.isin(GENEALOGY_PROPS) & e.o.map(_is_entity)]
        nxt = sorted({qid(o) for o in gen.o} - set(people))
        for p in nxt:
            people[p] = hop + 1
        frontier = nxt
        if not frontier:
            break

    edges = pd.concat(edges_all, ignore_index=True).drop_duplicates(["item", "prop", "o"])
    qual = pd.concat(qual_all, ignore_index=True)
    meta = pd.concat(meta_all, ignore_index=True)
    meta["item"] = meta["item"].map(qid)
    meta = meta.drop_duplicates("item")
    pd.DataFrame({"qid": list(people), "hop": list(people.values())}).to_parquet(
        INTERIM / "people_hops.parquet"
    )
    edges.to_parquet(INTERIM / "claims_simple.parquet")
    qual.to_parquet(INTERIM / "claims_qualified.parquet")
    meta.to_parquet(INTERIM / "person_meta.parquet")

    # --- target entities --------------------------------------------------
    targets = set(edges.loc[edges.prop.isin(ENTITY_PROPS), "o"]) | set(qual["o"])
    targets = sorted({qid(t) for t in targets if _is_entity(t)} - set(people))
    print(f"target entities: {len(targets):,}")
    ent = pd.DataFrame(run_batched(load_template("05_entity_meta.rq"), targets, 400, "entities"))
    ent["e"] = ent["e"].map(qid)

    # countries referenced by places/institutions + citizenship targets
    countries = set(ent["country"].dropna().map(qid))
    countries |= {qid(o) for o in edges.loc[edges.prop == "P27", "o"] if _is_entity(o)}
    countries = sorted(countries)
    cty = pd.DataFrame(run_batched(load_template("06_country_coords.rq"), countries, 400, "countries"))
    cty["e"] = cty["e"].map(qid)
    ent.to_parquet(INTERIM / "entity_meta.parquet")
    cty.to_parquet(INTERIM / "country_meta.parquet")
    print(
        f"done: people={len(people):,} claims={len(edges):,} qualified={len(qual):,} "
        f"entities={len(ent):,} countries={len(cty):,}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
