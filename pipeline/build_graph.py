"""Assemble data/interim/* into typed node/edge Parquet tables + a DuckDB file."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote

import duckdb
import pandas as pd

from pipeline.graph_utils import (
    PHYS_FIELD_RE,
    break_cycles,
    classify_award,
    core_physicist_signals,
    is_core_physicist,
    normalize_country,
    symmetrize_advised,
    wd_precision_label,
    wd_year,
)

ROOT = Path(__file__).resolve().parents[1]
INTERIM = ROOT / "data/interim"
GRAPH = ROOT / "data/graph"
CLEAN = ROOT / "data/processed/physicists_clean.csv"
POINT_RE = re.compile(r"Point\(([-\d.eE]+) ([-\d.eE]+)\)")


def q(uri) -> str | None:
    if not isinstance(uri, str):
        return None
    tail = uri.rsplit("/", 1)[-1]
    return tail if re.fullmatch(r"Q\d+", tail) else None


def point(v) -> tuple[float | None, float | None]:
    m = POINT_RE.match(v) if isinstance(v, str) else None
    if not m:
        return None, None
    lon, lat = float(m.group(1)), float(m.group(2))
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None, None
    return lat, lon


def thumb(url) -> str | None:
    if not isinstance(url, str) or "FilePath/" not in url:
        return None
    fname = unquote(url.split("FilePath/", 1)[1])
    return "https://commons.wikimedia.org/wiki/Special:FilePath/" + fname.replace(" ", "_")


def main() -> int:
    GRAPH.mkdir(parents=True, exist_ok=True)
    hops = pd.read_parquet(INTERIM / "people_hops.parquet")
    simple = pd.read_parquet(INTERIM / "claims_simple.parquet")
    qual = pd.read_parquet(INTERIM / "claims_qualified.parquet")
    meta = pd.read_parquet(INTERIM / "person_meta.parquet")
    ent = pd.read_parquet(INTERIM / "entity_meta.parquet")
    cty = pd.read_parquet(INTERIM / "country_meta.parquet")
    clean = pd.read_csv(CLEAN)

    simple["target"] = simple["o"].map(q)
    qual["target"] = qual["o"].map(q)
    # Genealogy links sometimes point at concepts ("student of: physics" -> Q413). Anything
    # that is also the target of a field/award/employer/... statement is not a person.
    concept_props = ["P101", "P27", "P19", "P166", "P108", "P69", "P106", "P21", "P800"]
    concept_targets = set(simple.loc[simple.prop.isin(concept_props), "target"].dropna()) | set(
        qual.target.dropna()
    )
    miscast = sorted((set(hops.qid) & concept_targets) - set(clean.qid))
    hops = hops[~hops.qid.isin(miscast)]
    people_set = set(hops.qid)

    # ---- entity lookups ----------------------------------------------------
    ent["lat"], ent["lon"] = zip(*ent["coord"].map(point)) if len(ent) else ([], [])
    ent["country_qid"] = ent["country"].map(q)
    label = dict(zip(ent.e, ent.label))
    cty["lat"], cty["lon"] = zip(*cty["coord"].map(point))
    cty["label_raw"] = cty["label"]
    cty["label"] = cty["label"].map(normalize_country)
    country_label = dict(zip(cty.e, cty.label))
    label.update(country_label)
    meta["qid"] = meta["item"]
    label.update(dict(zip(meta.qid, meta.label)))

    nodes_country = cty.rename(columns={"e": "qid"})[["qid", "label", "iso3", "lat", "lon"]]

    def ent_table(qids: set[str], extra=None) -> pd.DataFrame:
        t = ent[ent.e.isin(qids)].rename(columns={"e": "qid"})
        t = t[["qid", "label", "country_qid", "lat", "lon"]].copy()
        t["country"] = t.country_qid.map(country_label)
        return t.reset_index(drop=True)

    # ---- edges ---------------------------------------------------------------
    def simple_edges(prop: str, cols=("person", "target")) -> pd.DataFrame:
        e = simple[(simple.prop == prop) & simple.target.notna()][["item", "target"]]
        return e.drop_duplicates().rename(columns={"item": cols[0], "target": cols[1]})

    advised_raw = symmetrize_advised(
        simple[simple.prop.isin(["P184", "P185"]) & simple.target.notna()][
            ["item", "prop", "target"]
        ]
    )
    # Keep only edges between people we fetched. Hop-1 people's own students (beyond the
    # expansion horizon) and links to concepts are dropped and counted.
    n_before = len(advised_raw)
    advised_raw = advised_raw[
        advised_raw.advisor.isin(people_set) & advised_raw.student.isin(people_set)
    ].reset_index(drop=True)
    dropped_horizon = n_before - len(advised_raw)

    def year_series(col_q, col_prec):
        return meta.set_index("qid")[col_q].map(wd_year)

    birth_meta = year_series("birth", "birthPrec").to_dict()
    clean_birth = dict(zip(clean.qid, clean.birth_year))
    birth_any = {
        k: (int(v) if pd.notna(v) else None) for k, v in {**birth_meta, **clean_birth}.items()
    }
    advised, removed = break_cycles(advised_raw, birth_any)

    student_of = simple_edges("P1066", ("student", "teacher"))
    influenced = simple_edges("P737", ("person", "influencer"))
    influenced["influencer_in_graph"] = influenced.influencer.isin(people_set)

    def qual_edges(prop: str) -> pd.DataFrame:
        e = qual[(qual.prop == prop) & qual.target.notna()].copy()
        for src, dst in [("time", "year"), ("start", "start_year"), ("end", "end_year")]:
            e[dst] = pd.to_numeric(e[src].map(wd_year), errors="coerce")
        e = e.rename(columns={"item": "person"})
        e = e.groupby(["person", "target"], as_index=False).agg(
            year=("year", "min"), start_year=("start_year", "min"), end_year=("end_year", "max")
        )
        for c in ["year", "start_year", "end_year"]:
            e[c] = e[c].astype("Int64")
        return e

    award_e = qual_edges("P166").rename(columns={"target": "award"})[["person", "award", "year"]]
    employer_e = qual_edges("P108").rename(columns={"target": "institution"})[
        ["person", "institution", "start_year", "end_year"]
    ]
    educated_e = qual_edges("P69").rename(columns={"target": "institution"})
    educated_e["start_year"] = educated_e["start_year"].fillna(educated_e["year"])
    educated_e = educated_e[["person", "institution", "start_year", "end_year"]]
    citizen_e = simple_edges("P27", ("person", "country"))
    field_e = simple_edges("P101", ("person", "field"))
    work_e = simple_edges("P800", ("person", "work"))
    born_e = simple_edges("P19", ("person", "place"))
    occ_e = simple_edges("P106", ("person", "occupation"))
    gender_e = simple_edges("P21", ("person", "gender"))

    # ---- node tables -----------------------------------------------------------
    awards = ent_table(set(award_e.award))[["qid", "label"]]
    cls = awards.label.map(classify_award)
    awards["is_major"] = [c[0] for c in cls]
    awards["major_group"] = [c[1] for c in cls]
    awards["is_nobel"] = [c[2] for c in cls]
    fields = ent_table(set(field_e.field))[["qid", "label"]]
    fields["is_physics"] = fields.label.fillna("").str.contains(PHYS_FIELD_RE)
    institutions = ent_table(set(employer_e.institution) | set(educated_e.institution))
    places = ent_table(set(born_e.place))
    works = ent_table(set(work_e.work))[["qid", "label"]]

    # ---- persons ---------------------------------------------------------------
    m = meta.set_index("qid")
    persons = hops.copy()
    persons["is_seed"] = persons.hop == 0
    persons["name"] = persons.qid.map(m["label"])
    persons["description"] = persons.qid.map(m["desc"])
    persons["sitelinks"] = pd.to_numeric(persons.qid.map(m["sitelinks"]), errors="coerce").astype(
        "Int64"
    )
    persons["wikipedia_url"] = persons.qid.map(m["article"])
    persons["birth_year"] = persons.qid.map(m["birth"]).map(wd_year)
    persons["death_year"] = persons.qid.map(m["death"]).map(wd_year)
    persons["birth_precision"] = persons.qid.map(m["birthPrec"]).map(wd_precision_label)
    persons["death_precision"] = persons.qid.map(m["deathPrec"]).map(wd_precision_label)
    persons.loc[persons.birth_year.isna(), "birth_precision"] = "missing"
    persons.loc[persons.death_year.isna(), "death_precision"] = "missing"

    # Seed people: dates come from the cleaned CSV (authoritative for this project).
    c = clean.set_index("qid")
    seed = persons.is_seed
    for col in [
        "birth_year",
        "death_year",
        "birth_precision",
        "death_precision",
    ]:
        persons.loc[seed, col] = persons.loc[seed, "qid"].map(c[col])
    for col in [
        "birth_date",
        "death_date",
        "has_conflict",
        "multi_statement",
        "death_missing_suspect",
        "lifespan_implausible",
        "vital_status",
        "name_raw",
    ]:
        persons[col] = persons.qid.map(c[col])
    persons["name"] = persons["name"].fillna(persons["name_raw"]).fillna(persons.qid)
    persons["wikipedia_url"] = persons["wikipedia_url"].fillna(persons.qid.map(c["wikipedia_url"]))
    for col in ["has_conflict", "multi_statement", "death_missing_suspect", "lifespan_implausible"]:
        persons[col] = persons[col].fillna(False).astype(bool)
    ext = ~seed
    by, dy = persons.birth_year, persons.death_year
    persons.loc[ext, "lifespan_implausible"] = (((dy - by) < 0) | ((dy - by) > 110)).fillna(False)[
        ext
    ]
    persons.loc[ext, "death_missing_suspect"] = (dy.isna() & (by < 1910)).fillna(False)[ext]
    persons.loc[ext, "vital_status"] = "dead"
    persons.loc[ext & dy.isna(), "vital_status"] = "presumed_alive"
    persons.loc[ext & dy.isna() & (by < 1910).fillna(False), "vital_status"] = "death_missing"
    persons.loc[ext & dy.isna() & by.isna(), "vital_status"] = "unknown"
    persons["birth_year"] = pd.to_numeric(persons.birth_year).astype("Int64")
    persons["death_year"] = pd.to_numeric(persons.death_year).astype("Int64")
    persons = persons.drop(columns=["name_raw"])

    img = simple[simple.prop == "P18"].drop_duplicates("item").set_index("item")["o"]
    persons["image"] = persons.qid.map(img).map(thumb)
    gender_label = gender_e.assign(lbl=gender_e.gender.map(label)).drop_duplicates("person")
    persons["gender"] = persons.qid.map(gender_label.set_index("person")["lbl"])

    # birthplace + birth country
    bp = born_e.drop_duplicates("person").set_index("person")["place"]
    pl = places.set_index("qid")
    persons["birth_place"] = persons.qid.map(bp)
    persons["birth_place_label"] = persons.birth_place.map(pl["label"])
    persons["birth_country_qid"] = persons.birth_place.map(pl["country_qid"])
    persons["birth_country"] = persons.birth_place.map(pl["country"])
    persons["birth_lat"] = persons.birth_place.map(pl["lat"])
    persons["birth_lon"] = persons.birth_place.map(pl["lon"])
    cit = citizen_e.groupby("person")["country"].first()
    persons["citizenship_qid"] = persons.qid.map(cit)
    persons["citizenship"] = persons.citizenship_qid.map(country_label)
    # Fallback country: birth country, else first citizenship.
    persons["country_qid"] = persons.birth_country_qid.fillna(persons.citizenship_qid)
    persons["country"] = persons.country_qid.map(country_label)

    # awards
    aw = award_e.merge(awards, left_on="award", right_on="qid", how="left")
    major = aw[aw.is_major.fillna(False).astype(bool)]
    persons["n_awards"] = persons.qid.map(aw.groupby("person").size()).fillna(0).astype(int)
    persons["n_major_awards"] = (
        persons.qid.map(major.groupby("person").size()).fillna(0).astype(int)
    )
    persons["is_laureate"] = persons.n_major_awards > 0
    nob = aw[aw.is_nobel.fillna(False).astype(bool)]
    persons["is_nobel"] = persons.qid.isin(nob.person)
    persons["nobel_physics_year"] = persons.qid.map(
        aw[aw.label == "Nobel Prize in Physics"].groupby("person")["year"].min()
    ).astype("Int64")
    persons["first_major_award_year"] = persons.qid.map(
        major.groupby("person")["year"].min()
    ).astype("Int64")
    persons["major_awards"] = persons.qid.map(
        major.groupby("person")["major_group"].agg(lambda s: sorted(set(s)))
    )

    # fields
    fl = field_e.merge(fields, left_on="field", right_on="qid")
    persons["fields"] = persons.qid.map(fl.groupby("person")["label"].agg(list))
    persons["primary_field"] = persons.qid.map(
        fl.sort_values("is_physics", ascending=False).groupby("person")["label"].first()
    )

    # core physicist heuristic
    occ_lbl = occ_e.assign(l=occ_e.occupation.map(label)).groupby("person")["l"].agg(list)
    aw_lbl = aw.groupby("person")["label"].agg(list)
    inst_lbl_map = institutions.set_index("qid")["label"]
    inst_all = pd.concat(
        [employer_e[["person", "institution"]], educated_e[["person", "institution"]]]
    )
    inst_lbl = (
        inst_all.assign(l=inst_all.institution.map(inst_lbl_map)).groupby("person")["l"].agg(list)
    )
    sigs = []
    for r in persons.itertuples(index=False):
        sigs.append(
            core_physicist_signals(
                r.description if isinstance(r.description, str) else None,
                r.fields if isinstance(r.fields, list) else [],
                [x for x in occ_lbl.get(r.qid, []) if isinstance(x, str)],
                [x for x in aw_lbl.get(r.qid, []) if isinstance(x, str)],
                [x for x in inst_lbl.get(r.qid, []) if isinstance(x, str)],
            )
        )
    sig_df = pd.DataFrame(sigs)
    for col in sig_df.columns:
        persons[col] = sig_df[col].values
    persons["is_core_physicist"] = [is_core_physicist(s) for s in sigs]

    persons["n_students"] = persons.qid.map(advised.groupby("advisor").size()).fillna(0).astype(int)
    persons["n_advisors"] = persons.qid.map(advised.groupby("student").size()).fillna(0).astype(int)
    persons["fields"] = persons["fields"].map(
        lambda v: json.dumps(v) if isinstance(v, list) else None
    )
    persons["major_awards"] = persons["major_awards"].map(
        lambda v: json.dumps(v) if isinstance(v, list) else None
    )

    # ---- write ---------------------------------------------------------------
    tables = {
        "nodes_person": persons,
        "nodes_institution": institutions,
        "nodes_award": awards,
        "nodes_field": fields,
        "nodes_place": places,
        "nodes_country": nodes_country,
        "nodes_work": works,
        "edges_advised": advised,
        "edges_advised_raw": advised_raw,
        "edges_student_of": student_of,
        "edges_influenced_by": influenced,
        "edges_award": award_e,
        "edges_employer": employer_e,
        "edges_educated": educated_e,
        "edges_citizenship": citizen_e,
        "edges_field": field_e,
        "edges_notable_work": work_e,
        "edges_born_in": born_e,
        "edges_occupation": occ_e,
    }
    for name, df in tables.items():
        df.to_parquet(GRAPH / f"{name}.parquet", index=False)
    (GRAPH / "advised_cycles_removed.json").write_text(json.dumps(removed, indent=1))
    (GRAPH / "build_notes.json").write_text(
        json.dumps(
            {
                "miscast_concepts": [{"qid": m, "label": label.get(m)} for m in miscast],
                "advised_dropped_beyond_horizon": int(dropped_horizon),
            },
            indent=1,
        )
    )

    dbp = GRAPH / "graph.duckdb"
    dbp.unlink(missing_ok=True)
    con = duckdb.connect(str(dbp))
    for name in tables:
        con.execute(f"CREATE TABLE {name} AS SELECT * FROM read_parquet('{GRAPH / name}.parquet')")
    con.close()

    print(
        f"persons={len(persons):,} (seed {int(seed.sum()):,}, core {int(persons[seed].is_core_physicist.sum()):,})"
        f"  advised={len(advised):,} (raw {len(advised_raw):,}, cycles broken {len(removed)})"
        f"  awards={len(award_e):,} major-award holders={int(persons.is_laureate.sum()):,}"
        f"  institutions={len(institutions):,} employer edges={len(employer_e):,}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
