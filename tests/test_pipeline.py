import pandas as pd
import pytest

from pipeline.graph_utils import (
    break_cycles,
    classify_award,
    core_physicist_signals,
    is_core_physicist,
    symmetrize_advised,
    wd_precision_label,
    wd_year,
)
from src.clean import clean, parse_date, pick_best, qid_from_uri


# ---- date parsing -----------------------------------------------------------
@pytest.mark.parametrize(
    "text,year,prec,iso",
    [
        ("6 February 1941", 1941, "day", "1941-02-06"),
        ("1 January 1964", 1964, "year", None),  # year precision, never a real date
        ("1 January 0287 BCE", -287, "year", None),
        ("15 March 0044 BCE", -44, "day", "-0044-03-15"),
        ("", None, "missing", None),
        (None, None, "missing", None),
        ("sometime 1900", None, "unparsed", None),
    ],
)
def test_parse_date(text, year, prec, iso):
    p = parse_date(text)
    assert p.year == year and p.precision == prec and p.iso == iso


def test_wd_year_and_precision():
    assert wd_year("1879-03-14T00:00:00Z") == 1879
    assert wd_year("-0287-01-01T00:00:00Z") == -287
    assert wd_year("http://example/blank") is None
    assert wd_precision_label("11") == "day"
    assert wd_precision_label("9") == "year"
    assert wd_precision_label(None) == "missing"


# ---- dedupe / conflict resolution ------------------------------------------
def test_pick_best_prefers_precise_and_flags_conflicts():
    best, conflict, n = pick_best(["1 January 1900", "3 May 1900"])
    assert best.precision == "day" and best.day == 3
    assert conflict is False  # same year, one is just less precise
    best, conflict, n = pick_best(["3 May 1900", "4 May 1901", "3 May 1900"])
    assert (best.year, best.day) == (1900, 3) and conflict is True and n == 2
    best, conflict, n = pick_best(["", ""])
    assert best.precision == "missing" and not conflict


def test_qid_from_uri():
    assert qid_from_uri("http://www.wikidata.org/entity/Q937") == "Q937"


def _raw(rows):
    cols = [
        "explore href",
        "item-link",
        "tablescraper-selected-row",
        "tablescraper-selected-row 2",
        "item-link 2",
        "item-link href 2",
        "tablescraper-selected-row 3",
    ]
    return pd.DataFrame(rows, columns=cols)


def test_clean_dedupes_and_flags():
    raw = _raw(
        [
            ["http://www.wikidata.org/entity/Q1", "", "Ann", "3 May 1850", "", "https://en.wikipedia.org/wiki/Ann", ""],
            ["http://www.wikidata.org/entity/Q1", "", "Q1", "4 May 1851", "", "", ""],
            ["http://www.wikidata.org/entity/Q2", "", "Q2", "1 January 1950", "", "https://en.wikipedia.org/wiki/Bo_Bo", ""],
            ["http://www.wikidata.org/entity/Q3", "", "Cy", "1 January 0287 BCE", "", "", "1 January 0212 BCE"],
        ]
    )
    df = clean(raw).set_index("qid")
    assert len(df) == 3
    assert df.loc["Q1", "has_conflict"] and df.loc["Q1", "multi_statement"]
    assert df.loc["Q1", "name_raw"] == "Ann"
    # pre-1910 with no death -> missing, not alive
    assert df.loc["Q1", "death_missing_suspect"] and df.loc["Q1", "vital_status"] == "death_missing"
    assert df.loc["Q2", "name_raw"] == "Bo Bo"
    assert df.loc["Q2", "birth_precision"] == "year" and df.loc["Q2", "vital_status"] == "presumed_alive"
    assert df.loc["Q3", "birth_year"] == -287 and df.loc["Q3", "lifespan"] == 75


# ---- edge symmetrisation ------------------------------------------------------
def test_symmetrize_advised_merges_both_directions():
    claims = pd.DataFrame(
        [
            ("S1", "P184", "A"),  # S1's advisor is A
            ("A", "P185", "S1"),  # A's student is S1 (same edge)
            ("A", "P185", "S2"),  # only recorded on the advisor
            ("S3", "P184", "B"),  # only recorded on the student
            ("X", "P184", "X"),  # self loop dropped
        ],
        columns=["item", "prop", "target"],
    )
    e = symmetrize_advised(claims)
    pairs = set(zip(e.advisor, e.student))
    assert pairs == {("A", "S1"), ("A", "S2"), ("B", "S3")}
    row = e[(e.advisor == "A") & (e.student == "S1")].iloc[0]
    assert row.both_directions and row.via_p184 and row.via_p185
    assert not e[(e.student == "S2")].iloc[0].both_directions


# ---- cycle breaking --------------------------------------------------------------
def test_break_cycles_removes_implausible_edge():
    edges = pd.DataFrame(
        {
            "advisor": ["A", "B", "C", "D"],
            "student": ["B", "C", "A", "E"],
            "both_directions": [True, True, False, True],
        }
    )
    born = {"A": 1800, "B": 1830, "C": 1860, "D": 1900, "E": 1930}
    dag, removed = break_cycles(edges, born)
    assert len(removed) == 1
    # C(1860) -> A(1800): student 60 years older than advisor -> the one to drop
    assert removed[0]["removed_advisor"] == "C" and removed[0]["removed_student"] == "A"
    assert len(dag) == 3


def test_break_cycles_two_cycle():
    edges = pd.DataFrame({"advisor": ["A", "B"], "student": ["B", "A"], "both_directions": [False, False]})
    dag, removed = break_cycles(edges, {"A": 1900, "B": 1950})
    assert len(dag) == 1 and dag.iloc[0].advisor == "A"


# ---- classification -----------------------------------------------------------------
def test_classify_award():
    assert classify_award("Nobel Prize in Physics") == (True, "Nobel", True)
    assert classify_award("Fields Medal")[0]
    assert classify_award("Knight of the Legion of Honour") == (False, None, False)


def test_core_physicist():
    s = core_physicist_signals("German politician", [], ["physicist", "politician"], [], [])
    assert not is_core_physicist(s)
    s = core_physicist_signals("Greek philosopher", ["philosophy"], ["philosopher"], [], [])
    assert not is_core_physicist(s)
    s = core_physicist_signals(None, ["quantum mechanics"], [], [], [])
    assert is_core_physicist(s)
    s = core_physicist_signals("American theoretical physicist", [], [], [], [])
    assert is_core_physicist(s)
