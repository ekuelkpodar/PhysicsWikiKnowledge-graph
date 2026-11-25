"""Shared loaders/helpers for the model scripts."""

from __future__ import annotations

import json
import math
from functools import cache
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
GRAPH = ROOT / "data/graph"
OUT = ROOT / "data/models"
CURRENT_YEAR = 2025  # censoring horizon: last full year of data
RNG_SEED = 42


@cache
def table(name: str) -> pd.DataFrame:
    return pd.read_parquet(GRAPH / f"{name}.parquet")


def persons() -> pd.DataFrame:
    return table("nodes_person").copy()


def _clean(o):
    if isinstance(o, float) and (math.isnan(o) or math.isinf(o)):
        return None
    if isinstance(o, (np.floating,)):
        f = float(o)
        return None if (math.isnan(f) or math.isinf(f)) else round(f, 6)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if o is pd.NA or o is pd.NaT:
        return None
    if isinstance(o, dict):
        return {str(k): _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple, np.ndarray)):
        return [_clean(v) for v in o]
    if isinstance(o, float):
        return round(o, 6)
    return o


def write_json(name: str, obj) -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    p = OUT / name
    p.write_text(json.dumps(_clean(obj), separators=(",", ":"), ensure_ascii=False))
    return p


def read_json(name: str):
    return json.loads((OUT / name).read_text())


def wikidata_url(qid: str) -> str:
    return f"https://www.wikidata.org/wiki/{qid}"


def employment_spans(default_start_age: int = 27, default_len: int = 30) -> pd.DataFrame:
    """Employer edges with start/end years, filling missing ends from career heuristics.

    Missing start: birth + 27 (PhD-age proxy). Missing end: min(death, start + 30, 2025).
    `inferred` marks rows where either bound was imputed.
    """
    e = table("edges_employer").copy()
    p = table("nodes_person").set_index("qid")
    by = e.person.map(p.birth_year)
    dy = e.person.map(p.death_year)
    start = e.start_year.astype("Float64")
    end = e.end_year.astype("Float64")
    inferred = start.isna() | end.isna()
    start = start.fillna(by.astype("Float64") + default_start_age)
    cap = (start + default_len).clip(upper=CURRENT_YEAR)
    end = end.fillna(pd.concat([dy.astype("Float64"), cap], axis=1).min(axis=1))
    e["start"] = start
    e["end"] = end
    e["inferred"] = inferred
    return e.dropna(subset=["start", "end"])
