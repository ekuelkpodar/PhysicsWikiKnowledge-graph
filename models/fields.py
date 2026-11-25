"""Model 6: field evolution.

Field co-occurrence network (two fields linked when one person lists both) per 25-year
birth cohort, Leiden communities (modularity, seeded), labelled by their most common
fields. Communities in consecutive cohorts are linked by the people-mass of the fields
they share -> alluvial chart. A global (all-cohort) partition gives every person a
`field_community` used to colour the graph explorer.
"""

from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from itertools import combinations

import igraph as ig
import leidenalg as la
import pandas as pd

from models.common import RNG_SEED, persons, table, write_json

COHORT = 25
COHORT_START, COHORT_END = 1800, 2000
GENERIC = {"physics", "science", "natural science", "research", "mathematics and physics"}
MIN_COMMUNITY_PEOPLE = 8
GLOBAL_K = 6  # coloured communities in the explorer (validated 6-slot palette); rest -> "other"


def person_fields() -> pd.DataFrame:
    f = table("edges_field").merge(
        table("nodes_field")[["qid", "label"]], left_on="field", right_on="qid"
    )
    f = f[~f.label.str.lower().isin(GENERIC)]
    return f[["person", "field", "label"]]


def leiden(person_sets: dict[str, set]) -> tuple[dict[str, int], Counter]:
    """Leiden on the field co-occurrence graph. Returns field->community, field counts."""
    counts: Counter = Counter()
    pair_w: Counter = Counter()
    for fs in person_sets.values():
        counts.update(fs)
        for a, b in combinations(sorted(fs), 2):
            pair_w[(a, b)] += 1
    fields = sorted(counts)
    idx = {f: i for i, f in enumerate(fields)}
    g = ig.Graph(n=len(fields), edges=[(idx[a], idx[b]) for a, b in pair_w], directed=False)
    g.es["weight"] = list(pair_w.values())
    # Isolated fields (only ever listed alone) form singleton communities.
    part = la.find_partition(g, la.ModularityVertexPartition, weights="weight", seed=RNG_SEED)
    return {fields[i]: c for c, members in enumerate(part) for i in members}, counts


def assign(person_sets, comm) -> dict[str, int]:
    out = {}
    for p, fs in person_sets.items():
        c = Counter(comm[f] for f in fs if f in comm)
        if c:
            out[p] = c.most_common(1)[0][0]
    return out


def main() -> int:
    pf = person_fields()
    flabel = dict(zip(pf.field, pf.label))
    people = persons().set_index("qid")
    sets = pf.groupby("person").field.agg(set).to_dict()

    # ---- global partition for colouring ------------------------------------------
    gcomm, gcounts = leiden(sets)
    gassign = assign(sets, gcomm)
    sizes = Counter(gassign.values())
    top = [c for c, _ in sizes.most_common(GLOBAL_K)]
    remap = {c: i for i, c in enumerate(top)}
    global_comms = []
    for c in top:
        members = [f for f, cc in gcomm.items() if cc == c]
        members.sort(key=lambda f: -gcounts[f])
        global_comms.append(
            {
                "id": remap[c],
                "people": sizes[c],
                "top_fields": [flabel[f] for f in members[:6]],
                "label": " · ".join(flabel[f] for f in members[:2]),
            }
        )
    person_comm = {p: remap.get(c, -1) for p, c in gassign.items()}

    # ---- per-cohort partitions ---------------------------------------------------
    by = people.birth_year
    nodes, links = [], []
    prev = None
    for start in range(COHORT_START, COHORT_END, COHORT):
        coh = [p for p in sets if pd.notna(by.get(p)) and start <= by[p] < start + COHORT]
        csets = {p: sets[p] for p in coh}
        if len(csets) < 30:
            continue
        comm, counts = leiden(csets)
        asg = assign(csets, comm)
        csize = Counter(asg.values())
        field_mass = defaultdict(Counter)  # community -> field -> people
        for p, c in asg.items():
            for f in csets[p]:
                field_mass[c][f] += 1
        cur = {}
        for c, n in csize.items():
            if n < MIN_COMMUNITY_PEOPLE:
                continue
            top_f = [flabel[f] for f, _ in field_mass[c].most_common(4)]
            gl = Counter(person_comm.get(p, -1) for p, cc in asg.items() if cc == c).most_common(1)
            nid = f"{start}:{c}"
            nodes.append(
                {
                    "id": nid,
                    "cohort": start,
                    "people": n,
                    "top_fields": top_f,
                    "label": " · ".join(top_f[:2]),
                    "global_community": gl[0][0] if gl else -1,
                    "people_qids": [p for p, cc in asg.items() if cc == c][:400],
                }
            )
            cur[nid] = field_mass[c]
        if prev:
            for a, fa in prev.items():
                for b, fb in cur.items():
                    w = sum(min(fa[f], fb[f]) for f in fa.keys() & fb.keys())
                    if w >= 2:
                        links.append(
                            {
                                "source": a,
                                "target": b,
                                "value": int(w),
                                "shared_fields": [flabel[f] for f, _ in (fa & fb).most_common(3)],
                            }
                        )
        prev = cur
    payload = {
        "cohort_years": COHORT,
        "global_communities": global_comms,
        "person_community": person_comm,
        "alluvial": {"nodes": nodes, "links": links},
        "n_people_with_fields": len(sets),
        "excluded_generic_fields": sorted(GENERIC),
    }
    write_json("fields_alluvial.json", payload)
    print(
        f"fields: {len(sets):,} people with specific fields; {len(nodes)} cohort communities, "
        f"{len(links)} flows"
    )
    for c in global_comms:
        print(f"  [{c['id']}] {c['people']:5d}  {', '.join(c['top_fields'][:4])}")
    _ = json
    return 0


if __name__ == "__main__":
    sys.exit(main())
