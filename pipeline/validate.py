"""Validate data/graph and write data/quality_report.json. Exits non-zero on hard failures."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import networkx as nx
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
GRAPH = ROOT / "data/graph"
REPORT = ROOT / "data/quality_report.json"
CURRENT_YEAR = 2026

EDGE_ENDPOINTS = {
    "edges_advised": [("advisor", "nodes_person"), ("student", "nodes_person")],
    "edges_award": [("person", "nodes_person"), ("award", "nodes_award")],
    "edges_employer": [("person", "nodes_person"), ("institution", "nodes_institution")],
    "edges_educated": [("person", "nodes_person"), ("institution", "nodes_institution")],
    "edges_field": [("person", "nodes_person"), ("field", "nodes_field")],
    "edges_born_in": [("person", "nodes_person"), ("place", "nodes_place")],
    "edges_citizenship": [("person", "nodes_person"), ("country", "nodes_country")],
}


def load(name: str) -> pd.DataFrame:
    return pd.read_parquet(GRAPH / f"{name}.parquet")


def main() -> int:
    hard_failures: list[str] = []
    report: dict = {"row_counts": {}, "orphans": {}, "cycles": {}, "dates": {}}
    names = sorted(p.stem for p in GRAPH.glob("*.parquet"))
    tables = {n: load(n) for n in names}
    for n, df in tables.items():
        report["row_counts"][n] = len(df)

    persons = tables["nodes_person"]
    seed = persons[persons.is_seed]
    if len(seed) != 11931:
        hard_failures.append(f"expected 11,931 seed people, got {len(seed):,}")
    if persons.qid.duplicated().any():
        hard_failures.append("duplicate person QIDs")

    # Orphans: an edge whose endpoint is missing from the node table. Advisors and
    # students outside the expansion horizon are expected; these are reported, not fatal.
    for e, ends in EDGE_ENDPOINTS.items():
        df = tables[e]
        report["orphans"][e] = {}
        for col, node in ends:
            ids = set(tables[node].qid)
            n_orph = int((~df[col].isin(ids)).sum())
            report["orphans"][e][col] = n_orph

    # Cycles
    removed = json.loads((GRAPH / "advised_cycles_removed.json").read_text())
    g = nx.DiGraph(list(zip(tables["edges_advised"].advisor, tables["edges_advised"].student)))
    is_dag = nx.is_directed_acyclic_graph(g)
    report["cycles"] = {
        "n_removed": len(removed),
        "dag_after_breaking": is_dag,
        "removed": removed[:100],
    }
    if not is_dag:
        hard_failures.append("edges_advised is not a DAG after cycle breaking")

    # Impossible / suspicious dates
    by, dy = persons.birth_year, persons.death_year
    life = dy - by
    by_year = persons.set_index("qid")["birth_year"]
    adv = tables["edges_advised"].copy()
    adv["gap"] = adv.student.map(by_year) - adv.advisor.map(by_year)
    aw = tables["edges_award"].copy()
    aw["age"] = aw.year - aw.person.map(by_year)
    aw["after_death"] = aw.year - aw.person.map(persons.set_index("qid")["death_year"])
    dates = {
        "death_before_birth": persons.loc[(life < 0).fillna(False), "qid"].tolist(),
        "lifespan_over_110": persons.loc[(life > 110).fillna(False), "qid"].tolist(),
        "born_in_future": persons.loc[(by > CURRENT_YEAR).fillna(False), "qid"].tolist(),
        "alive_over_110": persons.loc[
            (dy.isna() & (CURRENT_YEAR - by > 110) & (by >= 1910)).fillna(False), "qid"
        ].tolist(),
        "missing_death_pre_1910_seed": seed.loc[seed.death_missing_suspect, "qid"].tolist(),
        "student_older_than_advisor": adv.loc[
            (adv.gap < 0).fillna(False), ["advisor", "student", "gap"]
        ]
        .astype({"gap": int})
        .to_dict("records"),
        "advisor_gap_under_10": int(((adv.gap >= 0) & (adv.gap < 10)).fillna(False).sum()),
        "award_before_age_15": aw.loc[(aw.age < 15).fillna(False), ["person", "award", "year"]]
        .astype({"year": int})
        .to_dict("records"),
        "award_over_5y_after_death": int((aw.after_death > 5).fillna(False).sum()),
    }
    report["dates"] = {
        k: ({"count": len(v), "items": v[:200]} if isinstance(v, list) else {"count": v})
        for k, v in dates.items()
    }
    report["summary"] = {
        "people_seed": int(len(seed)),
        "people_total": int(len(persons)),
        "multi_statement": int(seed.multi_statement.sum()),
        "genuine_conflicts": int(seed.has_conflict.sum()),
        "year_only_births": int((seed.birth_precision == "year").sum()),
        "missing_birth": int(seed.birth_year.isna().sum()),
        "no_death_date": int(seed.death_year.isna().sum()),
        "death_missing_suspect": int(seed.death_missing_suspect.sum()),
        "bce_births": int((seed.birth_year < 0).sum()),
        "core_physicists": int(seed.is_core_physicist.sum()),
        "advised_edges": int(len(tables["edges_advised"])),
        "advised_cycles_removed": len(removed),
        "advised_one_direction_only": int((~tables["edges_advised"].both_directions).sum()),
    }
    report["hard_failures"] = hard_failures
    REPORT.write_text(json.dumps(report, indent=1, default=str))
    print(json.dumps(report["summary"], indent=1))
    print("orphans:", {k: v for k, v in report["orphans"].items()})
    for k, v in report["dates"].items():
        print(f"  {k}: {v['count']}")
    if hard_failures:
        print("HARD FAILURES:", hard_failures)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
