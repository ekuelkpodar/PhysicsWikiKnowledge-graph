"""Model 1: academic genealogy on the ADVISED DAG.

Per person: descendants, descendant laureates, generation depth, subtree height,
ancestry PageRank. Founders ranked by laureate yield with Bayesian smoothing so tiny
trees with one laureate don't top the chart. Writes genealogy_metrics.json and
genealogy_subtrees.json (depth-capped ancestor/descendant subtrees).
"""

from __future__ import annotations

import sys

import networkx as nx
import pandas as pd

from models.common import persons, table, write_json

MAX_DEPTH = 6
MAX_SUBTREE_NODES = 400
MIN_FOUNDER_TREE = 20


def build_dag() -> nx.DiGraph:
    e = table("edges_advised")
    g = nx.DiGraph()
    g.add_nodes_from(persons().qid)
    g.add_edges_from(zip(e.advisor, e.student))
    return g


def generation_depth(g: nx.DiGraph) -> dict[str, int]:
    """Longest path length from any root (root = generation 0)."""
    depth: dict[str, int] = {}
    for n in nx.topological_sort(g):
        preds = list(g.predecessors(n))
        depth[n] = 0 if not preds else 1 + max(depth[p] for p in preds)
    return depth


def subtree_height(g: nx.DiGraph) -> dict[str, int]:
    h: dict[str, int] = {}
    for n in reversed(list(nx.topological_sort(g))):
        succ = list(g.successors(n))
        h[n] = 0 if not succ else 1 + max(h[s] for s in succ)
    return h


def bfs_limited(g: nx.DiGraph, src: str, forward: bool, max_depth: int, max_nodes: int):
    """Return list of (parent, child) edges within max_depth, capped at max_nodes."""
    nbrs = g.successors if forward else g.predecessors
    seen = {src}
    frontier = [src]
    edges = []
    for _ in range(max_depth):
        nxt = []
        for u in frontier:
            for v in nbrs(u):
                edges.append((u, v) if forward else (v, u))
                if v not in seen:
                    seen.add(v)
                    nxt.append(v)
                    if len(seen) >= max_nodes:
                        return edges, True
        frontier = nxt
        if not frontier:
            break
    return edges, False


def main() -> int:
    p = persons().set_index("qid")
    g = build_dag()
    assert nx.is_directed_acyclic_graph(g)
    laureate = p.is_laureate.to_dict()
    nobel = p.is_nobel.to_dict()

    # descendant sets via reverse topological union (exact, handles multi-advisor DAG)
    desc: dict[str, set] = {}
    for n in reversed(list(nx.topological_sort(g))):
        s: set = set()
        for c in g.successors(n):
            s.add(c)
            s |= desc[c]
        desc[n] = s
    depth = generation_depth(g)
    height = subtree_height(g)
    pr = nx.pagerank(g.reverse(copy=False), alpha=0.85)
    n_desc = {k: len(v) for k, v in desc.items()}
    desc_laur = {k: sum(laureate.get(x, False) for x in v) for k, v in desc.items()}
    desc_nobel = {k: sum(nobel.get(x, False) for x in v) for k, v in desc.items()}
    anc_laur = {}
    for n in g.nodes:
        anc = nx.ancestors(g, n) if g.in_degree(n) else set()
        anc_laur[n] = sum(laureate.get(x, False) for x in anc)

    metrics = pd.DataFrame(
        {
            "qid": list(g.nodes),
            "descendants": [n_desc[n] for n in g.nodes],
            "descendant_laureates": [desc_laur[n] for n in g.nodes],
            "descendant_nobels": [desc_nobel[n] for n in g.nodes],
            "generation": [depth[n] for n in g.nodes],
            "subtree_height": [height[n] for n in g.nodes],
            "students": [g.out_degree(n) for n in g.nodes],
            "advisors": [g.in_degree(n) for n in g.nodes],
            "ancestor_laureates": [anc_laur[n] for n in g.nodes],
            "pagerank": [pr[n] for n in g.nodes],
        }
    )
    # Bayesian-smoothed yield: shrink toward the global laureate rate with prior weight k.
    in_trees = metrics[metrics.descendants > 0]
    all_desc = set().union(*[desc[n] for n in in_trees.qid]) if len(in_trees) else set()
    base_rate = sum(laureate.get(x, False) for x in all_desc) / max(len(all_desc), 1)
    k = 50
    metrics["yield"] = metrics.descendant_laureates / metrics.descendants.where(
        metrics.descendants > 0
    )
    metrics["yield_smoothed"] = (metrics.descendant_laureates + k * base_rate) / (
        metrics.descendants + k
    )
    metrics["pagerank_pct"] = metrics.pagerank.rank(pct=True)

    founders = metrics[metrics.descendants >= MIN_FOUNDER_TREE].merge(
        p[["name", "birth_year", "death_year", "is_laureate", "is_seed", "image"]],
        left_on="qid",
        right_index=True,
    )
    founders["is_root"] = founders.advisors == 0
    founders["lift"] = founders["yield"] / base_rate
    top = founders.sort_values("yield_smoothed", ascending=False).head(60)
    top_size = founders.sort_values("descendants", ascending=False).head(60)
    top_laur = founders.sort_values("descendant_laureates", ascending=False).head(60)
    leaderboard = pd.concat([top, top_size, top_laur]).drop_duplicates("qid").reset_index(drop=True)

    # Depth-capped subtrees for everyone in a genealogy component.
    subtrees = {}
    for n in g.nodes:
        if g.degree(n) == 0:
            continue
        down, dtrunc = bfs_limited(g, n, True, MAX_DEPTH, MAX_SUBTREE_NODES)
        up, utrunc = bfs_limited(g, n, False, MAX_DEPTH, MAX_SUBTREE_NODES)
        subtrees[n] = {"down": down, "up": up, "truncated": dtrunc or utrunc}

    seed_tree = metrics[metrics.qid.isin(p.index[p.is_seed])]
    summary = {
        "nodes": g.number_of_nodes(),
        "edges": g.number_of_edges(),
        "people_in_genealogy": int((metrics.students + metrics.advisors > 0).sum()),
        "seed_in_genealogy": int(((seed_tree.students + seed_tree.advisors) > 0).sum()),
        "max_generation": int(metrics.generation.max()),
        "base_laureate_rate_in_trees": base_rate,
        "weakly_connected_components": nx.number_weakly_connected_components(
            g.subgraph([n for n in g.nodes if g.degree(n) > 0])
        ),
        "largest_component": max(
            (len(c) for c in nx.weakly_connected_components(g) if len(c) > 1), default=0
        ),
        "smoothing_prior_k": k,
        "min_founder_tree": MIN_FOUNDER_TREE,
    }
    write_json(
        "genealogy_metrics.json",
        {
            "summary": summary,
            "leaderboard": leaderboard.to_dict("records"),
            "per_person": metrics.to_dict("list"),
        },
    )
    write_json("genealogy_subtrees.json", subtrees)
    print(f"genealogy: {summary}")
    print(
        top[["name", "descendants", "descendant_laureates", "yield_smoothed", "lift"]]
        .head(10)
        .to_string()
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
