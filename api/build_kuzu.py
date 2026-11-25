"""Load data/graph/*.parquet into an embedded Kùzu database at api/kuzu_db."""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

import kuzu
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
GRAPH = ROOT / "data/graph"
DB = ROOT / "api/kuzu_db"

SCHEMA = [
    "CREATE NODE TABLE Person(qid STRING, name STRING, birth_year INT64, death_year INT64, "
    "description STRING, gender STRING, birth_country STRING, is_laureate BOOLEAN, is_nobel BOOLEAN, "
    "is_core BOOLEAN, is_seed BOOLEAN, descendants INT64, PRIMARY KEY(qid))",
    "CREATE NODE TABLE Institution(qid STRING, name STRING, country STRING, PRIMARY KEY(qid))",
    "CREATE NODE TABLE Award(qid STRING, name STRING, is_major BOOLEAN, is_nobel BOOLEAN, PRIMARY KEY(qid))",
    "CREATE NODE TABLE Field(qid STRING, name STRING, PRIMARY KEY(qid))",
    "CREATE NODE TABLE Country(qid STRING, name STRING, PRIMARY KEY(qid))",
    "CREATE REL TABLE ADVISED(FROM Person TO Person)",
    "CREATE REL TABLE WORKED_AT(FROM Person TO Institution, start_year INT64, end_year INT64)",
    "CREATE REL TABLE EDUCATED_AT(FROM Person TO Institution, start_year INT64, end_year INT64)",
    "CREATE REL TABLE RECEIVED(FROM Person TO Award, year INT64)",
    "CREATE REL TABLE WORKS_IN(FROM Person TO Field)",
    "CREATE REL TABLE CITIZEN_OF(FROM Person TO Country)",
]


def t(name):
    return pd.read_parquet(GRAPH / f"{name}.parquet")


def frames() -> dict[str, pd.DataFrame]:
    p = t("nodes_person")
    desc = {}
    gpath = ROOT / "data/models/genealogy_metrics.json"
    if gpath.exists():
        g = json.loads(gpath.read_text())["per_person"]
        desc = dict(zip(g["qid"], g["descendants"]))
    person = pd.DataFrame(
        {
            "qid": p.qid,
            "name": p.name,
            "birth_year": p.birth_year.astype("Int64"),
            "death_year": p.death_year.astype("Int64"),
            "description": p.description,
            "gender": p.gender,
            "birth_country": p.birth_country,
            "is_laureate": p.is_laureate.astype(bool),
            "is_nobel": p.is_nobel.astype(bool),
            "is_core": p.is_core_physicist.astype(bool),
            "is_seed": p.is_seed.astype(bool),
            "descendants": p.qid.map(desc).fillna(0).astype("int64"),
        }
    )
    ids = set(person.qid)
    inst = t("nodes_institution")[["qid", "label", "country"]].rename(columns={"label": "name"})
    award = t("nodes_award")[["qid", "label", "is_major", "is_nobel"]].rename(
        columns={"label": "name"}
    )
    field = t("nodes_field")[["qid", "label"]].rename(columns={"label": "name"})
    country = t("nodes_country")[["qid", "label"]].rename(columns={"label": "name"})
    for df in (inst, award, field, country):
        df.drop_duplicates("qid", inplace=True)
    adv = t("edges_advised")[["advisor", "student"]]
    adv = adv[adv.advisor.isin(ids) & adv.student.isin(ids)]

    def rel(df, a, b, keep, cols=()):
        df = df[df[a].isin(ids) & df[b].isin(set(keep.qid))]
        return df[[a, b, *cols]].drop_duplicates([a, b])

    return {
        "Person": person,
        "Institution": inst,
        "Award": award,
        "Field": field,
        "Country": country,
        "ADVISED": adv,
        "WORKED_AT": rel(
            t("edges_employer"), "person", "institution", inst, ["start_year", "end_year"]
        ),
        "EDUCATED_AT": rel(
            t("edges_educated"), "person", "institution", inst, ["start_year", "end_year"]
        ),
        "RECEIVED": rel(t("edges_award"), "person", "award", award, ["year"]),
        "WORKS_IN": rel(t("edges_field"), "person", "field", field),
        "CITIZEN_OF": rel(t("edges_citizenship"), "person", "country", country),
    }


def main() -> int:
    if DB.exists():
        shutil.rmtree(DB) if DB.is_dir() else DB.unlink()
    db = kuzu.Database(str(DB))
    conn = kuzu.Connection(db)
    for s in SCHEMA:
        conn.execute(s)
    with tempfile.TemporaryDirectory() as tmp:
        for name, df in frames().items():
            path = Path(tmp) / f"{name}.parquet"
            df.to_parquet(path, index=False)
            conn.execute(f"COPY {name} FROM '{path}'")
            print(f"  {name}: {len(df):,}")
    print(f"kuzu db at {DB}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
