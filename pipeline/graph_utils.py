"""Pure helpers shared by the pipeline and tests (no I/O)."""

from __future__ import annotations

import re

import networkx as nx
import pandas as pd

TIME_RE = re.compile(r"^([+-]?\d{1,6})-(\d\d)-(\d\d)")


def wd_year(value) -> int | None:
    """'1879-03-14T00:00:00Z' -> 1879, '-0287-01-01T..' -> -287. Non-dates -> None."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    m = TIME_RE.match(str(value))
    if not m:
        return None
    y = int(m.group(1))
    return y if y != 0 else None


def wd_precision_label(prec) -> str:
    try:
        p = int(prec)
    except (TypeError, ValueError):
        return "missing"
    return {11: "day", 10: "month", 9: "year", 8: "decade", 7: "century"}.get(
        p, "millennium" if p < 7 else "day"
    )


def symmetrize_advised(claims: pd.DataFrame) -> pd.DataFrame:
    """Turn P184 (doctoral advisor) and P185 (doctoral student) claims into one
    directed edge list advisor -> student, deduplicated, with provenance flags.

    `claims` has columns item, prop, target (all QIDs).
    """
    p184 = claims[claims.prop == "P184"]  # item's advisor is target
    p185 = claims[claims.prop == "P185"]  # item's student is target
    a = pd.DataFrame({"advisor": p184.target, "student": p184.item, "via_p184": True})
    b = pd.DataFrame({"advisor": p185.item, "student": p185.target, "via_p185": True})
    out = pd.concat([a, b], ignore_index=True)
    out = (
        out.groupby(["advisor", "student"], as_index=False)
        .agg(via_p184=("via_p184", "any"), via_p185=("via_p185", "any"))
        .fillna(False)
    )
    out["via_p184"] = out["via_p184"].astype(bool)
    out["via_p185"] = out["via_p185"].astype(bool)
    out = out[out.advisor != out.student]
    out["both_directions"] = out.via_p184 & out.via_p185
    return out.sort_values(["advisor", "student"]).reset_index(drop=True)


def break_cycles(
    edges: pd.DataFrame, birth_year: dict[str, int | None]
) -> tuple[pd.DataFrame, list[dict]]:
    """Remove the minimum number of edges needed to make ADVISED acyclic.

    Repeatedly find a cycle and drop the edge that is least plausible. An edge is less
    plausible if the student was born well before the advisor, if it is recorded in only
    one direction, or (as a deterministic tie-break) by lexical order.
    Returns (dag_edges, removed_log).
    """
    g = nx.DiGraph()
    meta = {}
    for r in edges.itertuples(index=False):
        g.add_edge(r.advisor, r.student)
        meta[(r.advisor, r.student)] = bool(getattr(r, "both_directions", False))
    removed: list[dict] = []

    def badness(e):
        a, s = e
        ba, bs = birth_year.get(a), birth_year.get(s)
        gap = (bs - ba) if (ba is not None and bs is not None) else None
        # negative gap = student older than advisor -> very suspicious
        gap_score = -gap if gap is not None else 0
        return (gap_score, 0 if meta.get(e) else 1, f"{a}>{s}")

    while True:
        try:
            cyc = nx.find_cycle(g)
        except nx.NetworkXNoCycle:
            break
        cyc_edges = [(u, v) for u, v, *_ in cyc]
        worst = max(cyc_edges, key=badness)
        g.remove_edge(*worst)
        removed.append(
            {
                "cycle": [u for u, _ in cyc_edges],
                "removed_advisor": worst[0],
                "removed_student": worst[1],
            }
        )
    keep = {(u, v) for u, v in g.edges}
    mask = [(a, s) in keep for a, s in zip(edges.advisor, edges.student)]
    return edges[mask].reset_index(drop=True), removed


# --- Award classification ------------------------------------------------
# Label -> group. Matched case-insensitively against the English label.
MAJOR_AWARDS = {
    "Nobel Prize in Physics": "Nobel",
    "Nobel Prize in Chemistry": "Nobel",
    "Nobel Prize in Physiology or Medicine": "Nobel",
    "Wolf Prize in Physics": "Wolf",
    "Wolf Prize in Chemistry": "Wolf",
    "Wolf Prize in Mathematics": "Wolf",
    # Labels exactly as Wikidata has them (audited against nodes_award, see DECISIONS.md)
    "ICTP Dirac Medal": "Dirac",
    "IOP Dirac Medal": "Dirac",
    "Breakthrough Prize in Fundamental Physics": "Breakthrough",
    "Special Breakthrough Prize in Fundamental Physics": "Breakthrough",
    "Fields Medal": "Fields",
    "Abel Prize": "Abel",
    "Max Planck Medal": "Max Planck Medal",
    "Copley Medal": "Copley",
    "Lorentz Medal": "Lorentz",
    "Albert Einstein Medal": "Einstein",
    "Albert Einstein Award": "Einstein",
    "Franklin Medal": "Franklin",
    "Benjamin Franklin Medal": "Franklin",
    "Hughes Medal": "Hughes",
    "Matteucci Medal": "Matteucci",
    "Oliver E. Buckley Condensed Matter Prize": "Buckley",
    "Dannie Heineman Prize for Mathematical Physics": "Heineman",
    "Sakurai Prize": "Sakurai",
    "Dannie Heineman Prize for Astrophysics": "Heineman",
    "Enrico Fermi Award": "Fermi",
    "Boltzmann Medal": "Boltzmann",
    "Crafoord Prize": "Crafoord",
    "Crafoord Prize in Astronomy": "Crafoord",
    "Crafoord Prize in Mathematics": "Crafoord",
    "Rumford Medal": "Rumford",
    "The Shaw Prize in Astronomy": "Shaw",
    "Kavli Prize in Astrophysics": "Kavli",
    "Kavli Prize in Nanoscience": "Kavli",
    "Isaac Newton Medal": "Newton",
    "Gold Medal of the Royal Astronomical Society": "RAS Gold",
    "Bruce Medal": "Bruce",
    "Holweck Prize": "Holweck",
    "Comstock Prize in Physics": "Comstock",
    "Wolf Prize": "Wolf",
}
_MAJOR_LOWER = {k.lower(): v for k, v in MAJOR_AWARDS.items()}


def classify_award(label: str | None) -> tuple[bool, str | None, bool]:
    """-> (is_major, group, is_nobel)."""
    if not isinstance(label, str) or not label:
        return False, None, False
    grp = _MAJOR_LOWER.get(label.strip().lower())
    low = label.strip().lower()
    is_nobel = low in {
        "nobel prize in physics",
        "nobel prize in chemistry",
        "nobel prize in physiology or medicine",
    }
    return grp is not None, grp, is_nobel


# --- Core physicist heuristic -------------------------------------------
PHYS_FIELD_RE = re.compile(
    r"physic|mechanic|optic|quantum|relativ|cosmolog|astro|thermodynam|electromagnet|"
    r"acoustic|nuclear|particle|plasma|condensed matter|crystallograph|spectroscop|"
    r"solid.state|statistical mechanics|fluid dynamics|string theory|gravitation|"
    r"field theory|semiconductor|superconduct|laser|photonic|radiation|biophysic|geophysic",
    re.I,
)
PHYS_DESC_RE = re.compile(r"physicist|astrophysicist|astronomer|cosmologist", re.I)
PHYS_OCC_RE = re.compile(r"physicist|astronomer|cosmologist", re.I)
PHYS_INST_RE = re.compile(r"physic|CERN|Fermilab|SLAC|Cavendish|Lawrence|Bell Lab", re.I)


def core_physicist_signals(
    description: str | None,
    field_labels: list[str],
    occupation_labels: list[str],
    award_labels: list[str],
    institution_labels: list[str],
) -> dict[str, bool]:
    def _s(xs):
        return [x for x in xs if isinstance(x, str) and x]

    field_labels, occupation_labels = _s(field_labels), _s(occupation_labels)
    award_labels, institution_labels = _s(award_labels), _s(institution_labels)
    if not isinstance(description, str):
        description = None
    occ = [o for o in occupation_labels if o.lower() != "physicist"]
    return {
        "sig_description": bool(description and PHYS_DESC_RE.search(description)),
        "sig_field": any(f and PHYS_FIELD_RE.search(f) for f in field_labels),
        "sig_occupation": any(PHYS_OCC_RE.search(o) for o in occ),
        "sig_award": any(
            a and ("physic" in a.lower() or a.lower() in _MAJOR_LOWER) for a in award_labels
        ),
        "sig_institution": any(i and PHYS_INST_RE.search(i) for i in institution_labels),
    }


def is_core_physicist(signals: dict[str, bool]) -> bool:
    """Core if any signal fires: the English description calls them a physicist or
    astronomer, a physics field of work, a specific physics occupation, a physics award,
    or a physics-named employer / education institution."""
    return any(signals.values())


# --- Country normalisation (today's borders) ------------------------------------
# Wikidata sometimes gives a historical state as a place's country. We map common
# predecessor states to the modern successor so "born in Russia, worked in the Russian
# Empire" is not counted as emigration. Ambiguous multi-successor states (Soviet Union,
# Austria-Hungary, Holy Roman Empire) map to the successor that holds most of the people
# (core territory); this is a documented approximation (see DECISIONS.md).
COUNTRY_ALIASES = {
    "People's Republic of China": "China",
    "Republic of China (1912–1949)": "China",
    "Qing dynasty": "China",
    "Soviet Union": "Russia",
    "Russian Empire": "Russia",
    "Russian Soviet Federative Socialist Republic": "Russia",
    "Tsardom of Russia": "Russia",
    "Kingdom of the Netherlands": "Netherlands",
    "Dutch Republic": "Netherlands",
    "United Kingdom of Great Britain and Ireland": "United Kingdom",
    "Kingdom of Great Britain": "United Kingdom",
    "Kingdom of England": "United Kingdom",
    "Kingdom of Scotland": "United Kingdom",
    "Kingdom of Prussia": "Germany",
    "German Reich": "Germany",
    "German Empire": "Germany",
    "Nazi Germany": "Germany",
    "Weimar Republic": "Germany",
    "West Germany": "Germany",
    "East Germany": "Germany",
    "German Confederation": "Germany",
    "North German Confederation": "Germany",
    "Kingdom of Bavaria": "Germany",
    "Kingdom of Saxony": "Germany",
    "Kingdom of Hanover": "Germany",
    "Kingdom of Württemberg": "Germany",
    "Grand Duchy of Baden": "Germany",
    "Holy Roman Empire": "Germany",
    "Kingdom of Denmark": "Denmark",
    "Denmark–Norway": "Denmark",
    "Kingdom of Italy": "Italy",
    "Papal States": "Italy",
    "Kingdom of the Two Sicilies": "Italy",
    "Kingdom of Sardinia": "Italy",
    "Grand Duchy of Tuscany": "Italy",
    "Kingdom of France": "France",
    "French First Republic": "France",
    "First French Empire": "France",
    "Second French Empire": "France",
    "French Third Republic": "France",
    "Austria–Hungary": "Austria",
    "Austrian Empire": "Austria",
    "Archduchy of Austria": "Austria",
    "Habsburg monarchy": "Austria",
    "Kingdom of Hungary": "Hungary",
    "Czechoslovakia": "Czech Republic",
    "Kingdom of Bohemia": "Czech Republic",
    "Yugoslavia": "Serbia",
    "Socialist Federal Republic of Yugoslavia": "Serbia",
    "Kingdom of Yugoslavia": "Serbia",
    "Ottoman Empire": "Turkey",
    "Empire of Japan": "Japan",
    "Polish–Lithuanian Commonwealth": "Poland",
    "Congress Poland": "Poland",
    "Second Polish Republic": "Poland",
    "Polish People's Republic": "Poland",
    "Kingdom of Poland": "Poland",
    "Swedish Empire": "Sweden",
    "Kingdom of Sweden": "Sweden",
    "Kingdom of Spain": "Spain",
    "Kingdom of Portugal": "Portugal",
    "British India": "India",
    "British Raj": "India",
    "Dominion of India": "India",
    "Ukrainian Soviet Socialist Republic": "Ukraine",
    "Byelorussian Soviet Socialist Republic": "Belarus",
    "Georgian Soviet Socialist Republic": "Georgia",
    "Armenian Soviet Socialist Republic": "Armenia",
    "Azerbaijan Soviet Socialist Republic": "Azerbaijan",
    "Mandatory Palestine": "Israel",
    "Union of South Africa": "South Africa",
    "Dominion of Canada": "Canada",
    "Province of Canada": "Canada",
    "Colony of New Zealand": "New Zealand",
    "Ancient Greece": "Greece",
    "Kingdom of Greece": "Greece",
}


def normalize_country(label):
    if not isinstance(label, str):
        return label
    return COUNTRY_ALIASES.get(label, label)
