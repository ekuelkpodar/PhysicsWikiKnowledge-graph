"""Model 5: institutional centrality over time.

For each decade D, the bipartite graph (person, institution) contains employment AND
education spans that overlap [D, D+10). Projected onto institutions (edge weight = people
shared within that decade), eigenvector centrality is computed on the weighted
projection. Top 15 per decade -> bump chart.
"""

from __future__ import annotations

import sys
from collections import defaultdict
from itertools import combinations

import networkx as nx
import pandas as pd

from models.common import employment_spans, persons, table, write_json

TOP = 15
DECADES = range(1850, 2030, 10)


def spans() -> pd.DataFrame:
    emp = employment_spans()[["person", "institution", "start", "end"]].assign(kind="employer")
    edu = table("edges_educated").copy()
    by = edu.person.map(persons().set_index("qid").birth_year).astype("Float64")
    edu["start"] = edu.start_year.astype("Float64").fillna(by + 18)
    edu["end"] = edu.end_year.astype("Float64").fillna(edu.start + 8)
    edu = edu.dropna(subset=["start"])[["person", "institution", "start", "end"]].assign(
        kind="educated"
    )
    return pd.concat([emp, edu], ignore_index=True)


def main() -> int:
    s = spans()
    inst = table("nodes_institution").set_index("qid")
    rows = []
    people_by = defaultdict(dict)
    for d in DECADES:
        act = s[(s.start < d + 10) & (s.end >= d)]
        by_person = act.groupby("person").institution.agg(lambda x: sorted(set(x)))
        g = nx.Graph()
        head = act.groupby("institution").person.nunique()
        g.add_nodes_from(head.index)
        for insts in by_person:
            for a, b in combinations(insts, 2):
                w = g.get_edge_data(a, b, {"weight": 0})["weight"]
                g.add_edge(a, b, weight=w + 1)
        if g.number_of_edges() == 0:
            continue
        cc = max(nx.connected_components(g), key=len)
        sub = g.subgraph(cc)
        try:
            ec = nx.eigenvector_centrality_numpy(sub, weight="weight")
        except Exception:
            ec = nx.eigenvector_centrality(sub, weight="weight", max_iter=2000)
        ranked = sorted(ec.items(), key=lambda kv: -kv[1])[:TOP]
        for rank, (i, sc) in enumerate(ranked, 1):
            rows.append(
                {
                    "decade": d,
                    "institution": i,
                    "label": inst.label.get(i) if isinstance(inst.label.get(i), str) else i,
                    "rank": rank,
                    "centrality": float(sc),
                    "headcount": int(head.get(i, 0)),
                    "country": inst.country.get(i),
                }
            )
            people_by[i][d] = act[act.institution == i].person.unique().tolist()[:60]
    df = pd.DataFrame(rows)
    insts = (
        df.groupby(["institution", "label", "country"], dropna=False)
        .agg(decades_in_top=("decade", "nunique"), best_rank=("rank", "min"))
        .reset_index()
    )
    payload = {
        "decades": sorted(df.decade.unique().tolist()),
        "rows": df.to_dict("records"),
        "institutions": insts.to_dict("records"),
        "people_by_institution_decade": {
            k: {str(d): v for d, v in dv.items()} for k, dv in people_by.items()
        },
        "method": "eigenvector centrality on decade-sliced person-institution projection",
    }
    write_json("institutions_bump.json", payload)
    lead = df[df["rank"] == 1][["decade", "label"]].to_string(index=False)
    print(f"institutions: {df.institution.nunique()} institutions ever in top {TOP}\n{lead}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
