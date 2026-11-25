import networkx as nx
import pandas as pd
import pytest

from api.text2cypher import UnsafeQuery, extract_cypher, guard
from models.genealogy import bfs_limited, generation_depth, subtree_height
from models.link_prediction import random_walks
from models.survival import PHD_AGE, censor_time


# ---- censoring logic ----------------------------------------------------------------
def _people(rows):
    return pd.DataFrame(
        rows, columns=["birth_year", "death_year", "vital_status", "first_major_award_year"]
    ).astype({"first_major_award_year": "Int64"})


def test_censoring_event_dead_alive_and_missing():
    df = _people(
        [
            (1900, 1980, "dead", 1950),  # event at 1950 - 1927 = 23
            (1900, 1980, "dead", None),  # censored at death: 1980 - 1927 = 53
            (1960, None, "presumed_alive", None),  # censored at 2025
            (1850, None, "death_missing", None),  # EXCLUDED, never "alive"
            (1900, 1950, "dead", 1960),  # award after death -> not an event in-window
            (1900, 1980, "dead", 1920),  # award before age 27 -> t = 0.5
        ]
    )
    out = censor_time(df)
    assert len(out) == 5
    assert 1850 not in out.birth_year.tolist()
    r = out.reset_index(drop=True)
    assert (r.loc[0, "T"], r.loc[0, "E"]) == (23, 1)
    assert (r.loc[1, "T"], r.loc[1, "E"]) == (53, 0)
    assert (r.loc[2, "T"], r.loc[2, "E"]) == (2025 - (1960 + PHD_AGE), 0)
    assert r.loc[3, "E"] == 0 and r.loc[3, "T"] == 1950 - 1927
    assert (r.loc[4, "T"], r.loc[4, "E"]) == (0.5, 1)


def test_censoring_drops_nonpositive_followup():
    out = censor_time(_people([(2010, None, "presumed_alive", None)]))  # clock starts 2037
    assert out.empty


# ---- genealogy -------------------------------------------------------------------------
def test_generation_and_height():
    g = nx.DiGraph([("A", "B"), ("B", "C"), ("A", "C"), ("D", "C")])
    assert generation_depth(g) == {"A": 0, "D": 0, "B": 1, "C": 2}
    assert subtree_height(g)["A"] == 2


def test_bfs_limited_caps_depth_and_size():
    g = nx.DiGraph([(i, i + 1) for i in range(10)])
    edges, trunc = bfs_limited(g, 0, True, 3, 100)
    assert len(edges) == 3 and not trunc
    edges, trunc = bfs_limited(g, 0, True, 10, 4)
    assert trunc


def test_random_walks_stay_on_graph():
    nodes, walks = random_walks([("a", "b"), ("b", "c")], walk_len=6, per_node=3)
    allowed = {(0, 1), (1, 0), (1, 2), (2, 1)}
    for w in walks:
        for x, y in zip(w[:-1], w[1:]):
            assert (x, y) in allowed


# ---- text2cypher guardrails ---------------------------------------------------------------
def test_guard_adds_and_clamps_limit():
    assert guard("MATCH (p:Person) RETURN p.qid").endswith("LIMIT 200")
    assert guard("MATCH (p:Person) RETURN p.qid LIMIT 5000").endswith("LIMIT 500")
    assert guard("MATCH (p:Person) RETURN p.qid LIMIT 10").endswith("LIMIT 10")


@pytest.mark.parametrize(
    "q",
    [
        "MATCH (p:Person) DETACH DELETE p",
        "CREATE (p:Person {qid: 'Q1'})",
        "MATCH (p:Person) SET p.name = 'x' RETURN p",
        "MATCH (p) RETURN p; DROP TABLE Person",
        "COPY Person FROM 'x.csv'",
        "CALL show_tables() RETURN *",
    ],
)
def test_guard_rejects_writes(q):
    with pytest.raises(UnsafeQuery):
        guard(q)


def test_guard_ignores_keywords_inside_strings():
    assert guard("MATCH (p:Person {name: 'Set Delete'}) RETURN p.qid LIMIT 1")


def test_extract_cypher():
    assert extract_cypher("Here:\n```cypher\nMATCH (n) RETURN n;\n```") == "MATCH (n) RETURN n"
