"""Model 3: time to first major award (survival analysis).

Clock starts at the PhD-age proxy (birth + 27). Event = first major award. Censoring:
  * dead without an award          -> censored at death
  * presumed alive without award   -> censored at 2025
  * no death date & born < 1910    -> EXCLUDED (missing, not censored)
Population: seed core physicists born 1850-1985 with known birth year and plausible
lifespan. Awards before the clock start are moved to t=0.5.

Cox PH (lifelines) vs Random Survival Forest (scikit-survival), compared on held-out
Harrell's C-index. Also exports Kaplan-Meier curves by group.
"""

from __future__ import annotations

import sys
import warnings

import numpy as np
import pandas as pd
from lifelines import CoxPHFitter, KaplanMeierFitter
from lifelines.statistics import logrank_test
from lifelines.utils import concordance_index
from sklearn.model_selection import train_test_split

from models.common import (
    CURRENT_YEAR,
    RNG_SEED,
    employment_spans,
    persons,
    read_json,
    table,
    write_json,
)

PHD_AGE = 27
COHORT_MIN, COHORT_MAX = 1850, 1985
TOP_COUNTRIES = [
    "United States",
    "Germany",
    "United Kingdom",
    "France",
    "Russia",
    "Italy",
    "Japan",
    "India",
]
FIELD_GROUPS = {
    "theoretical": r"theoretical|mathematical physics|quantum field|string|relativity|cosmolog",
    "particle/nuclear": r"particle|nuclear|high.energy",
    "condensed matter": r"condensed|solid.state|superconduct|semiconductor|materials",
    "astro": r"astro|astronomy|cosmolog",
    "optics/atomic": r"optic|laser|atomic|photon|spectroscop",
}


def censor_time(df: pd.DataFrame) -> pd.DataFrame:
    """Compute (T, E) with correct censoring. Expects birth_year, death_year,
    vital_status, first_major_award_year. Rows that cannot be timed are dropped."""
    start = df.birth_year + PHD_AGE
    award = df.first_major_award_year.astype("Float64")
    end_obs = np.where(df.vital_status == "dead", df.death_year, CURRENT_YEAR).astype(float)
    has_event = award.notna() & (award <= end_obs + 0.0)
    t = np.where(has_event, award - start, end_obs - start).astype(float)
    t = np.where(has_event & (t <= 0), 0.5, t)
    out = df.assign(T=t, E=has_event.astype(int).to_numpy())
    keep = out.vital_status.isin(["dead", "presumed_alive"]) & (out["T"] > 0)
    return out[keep]


def build_frame() -> pd.DataFrame:
    p = persons()
    gm = pd.DataFrame(read_json("genealogy_metrics.json")["per_person"]).set_index("qid")
    adv = table("edges_advised")
    pi = p.set_index("qid")
    adv = adv.assign(
        a_laur=adv.advisor.map(pi.is_laureate),
        a_pr=adv.advisor.map(gm.pagerank_pct),
    )
    g = adv.groupby("student").agg(laureate_advisor=("a_laur", "any"), advisor_pr=("a_pr", "max"))

    # top institutions = top 25 by number of distinct core physicists employed
    emp = employment_spans()
    core = set(p.qid[p.is_core_physicist & p.is_seed])
    top_inst = emp[emp.person.isin(core)].groupby("institution").person.nunique().nlargest(25).index
    top_emp = emp[emp.institution.isin(top_inst)].person.unique()

    df = p[p.is_seed & p.is_core_physicist & p.birth_year.between(COHORT_MIN, COHORT_MAX)]
    df = df[~df.lifespan_implausible]
    df = df.merge(g, left_on="qid", right_index=True, how="left")
    df["has_recorded_advisor"] = df.qid.isin(adv.student).astype(int)
    df["laureate_advisor"] = df.laureate_advisor.fillna(False).astype(int)
    df["advisor_pagerank_pct"] = df.advisor_pr.fillna(0.0)
    df["top_institution"] = df.qid.isin(top_emp).astype(int)
    df["female"] = (df.gender == "female").astype(int)
    df["country_grp"] = df.country.where(df.country.isin(TOP_COUNTRIES), "Other/unknown")
    df["cohort"] = (df.birth_year // 25 * 25).astype(int).astype(str) + "s"
    fields = df.fields.fillna("[]").str.lower()
    df["field_grp"] = "other/unknown"
    for k, rx in reversed(list(FIELD_GROUPS.items())):
        df.loc[fields.str.contains(rx, regex=True), "field_grp"] = k
    df = censor_time(df)
    return df


def km_curves(df: pd.DataFrame, col: str, labels: dict | None = None, min_n=40) -> dict:
    out = []
    for val, sub in df.groupby(col):
        if len(sub) < min_n:
            continue
        km = KaplanMeierFitter().fit(sub["T"], sub["E"])
        sf = km.survival_function_.iloc[:, 0]
        ci = km.confidence_interval_
        tt = np.arange(0, 61, 1)
        out.append(
            {
                "group": labels.get(val, str(val)) if labels else str(val),
                "n": int(len(sub)),
                "events": int(sub.E.sum()),
                "t": tt.tolist(),
                # cumulative incidence = 1 - S(t): share with a major award by year t
                "cum": (1 - sf.reindex(tt, method="ffill").fillna(1.0)).round(4).tolist(),
                "lo": (1 - ci.iloc[:, 1].reindex(tt, method="ffill").fillna(1.0)).round(4).tolist(),
                "hi": (1 - ci.iloc[:, 0].reindex(tt, method="ffill").fillna(1.0)).round(4).tolist(),
            }
        )
    res = {"by": col, "curves": out}
    if len(out) == 2:
        a, b = list(df.groupby(col))[:2]
        lr = logrank_test(a[1]["T"], b[1]["T"], a[1]["E"], b[1]["E"])
        res["logrank_p"] = float(lr.p_value)
    return res


def design(df: pd.DataFrame) -> pd.DataFrame:
    X = df[
        [
            "T",
            "E",
            "laureate_advisor",
            "advisor_pagerank_pct",
            "has_recorded_advisor",
            "top_institution",
            "female",
        ]
    ].copy()
    X = X.join(
        pd.get_dummies(df.country_grp, prefix="country").drop(
            columns=["country_Other/unknown"], errors="ignore"
        )
    )
    X = X.join(pd.get_dummies(df.cohort, prefix="cohort").iloc[:, 1:])
    X = X.join(
        pd.get_dummies(df.field_grp, prefix="field").drop(
            columns=["field_other/unknown"], errors="ignore"
        )
    )
    return X.astype(float)


def main() -> int:
    warnings.filterwarnings("ignore")
    df = build_frame()
    X = design(df)
    tr, te = train_test_split(X, test_size=0.25, random_state=RNG_SEED, stratify=X.E)
    cph = CoxPHFitter(penalizer=0.01).fit(tr, "T", "E")
    c_cox_test = concordance_index(te["T"], -cph.predict_partial_hazard(te), te["E"])
    cph_full = CoxPHFitter(penalizer=0.01).fit(X, "T", "E")
    s = cph_full.summary
    hr = [
        {
            "covariate": k,
            "hr": float(r["exp(coef)"]),
            "lo": float(r["exp(coef) lower 95%"]),
            "hi": float(r["exp(coef) upper 95%"]),
            "p": float(r["p"]),
        }
        for k, r in s.iterrows()
    ]
    # proportional-hazards check (Schoenfeld residual test), summarised
    try:
        from lifelines.statistics import proportional_hazard_test

        ph = proportional_hazard_test(cph_full, X, time_transform="rank").summary
        ph_viol = [k if isinstance(k, str) else k[0] for k in ph.index[ph.p < 0.01]]
    except Exception:  # pragma: no cover
        ph_viol = []

    # Random survival forest
    rsf_res = {}
    try:
        from sksurv.ensemble import RandomSurvivalForest
        from sksurv.util import Surv

        ytr = Surv.from_arrays(tr.E.astype(bool), tr["T"])
        rsf = RandomSurvivalForest(
            n_estimators=300, min_samples_leaf=15, n_jobs=-1, random_state=RNG_SEED
        )
        Xtr, Xte = tr.drop(columns=["T", "E"]), te.drop(columns=["T", "E"])
        rsf.fit(Xtr, ytr)
        c_rsf = concordance_index(te["T"], -rsf.predict(Xte), te["E"])
        rsf_res = {"c_index_test": float(c_rsf), "n_estimators": 300, "min_samples_leaf": 15}
    except Exception as exc:  # pragma: no cover
        rsf_res = {"error": str(exc)}

    km = {
        "laureate_advisor": km_curves(
            df, "laureate_advisor", {0: "Advisor not a laureate", 1: "Laureate advisor"}
        ),
        "has_recorded_advisor": km_curves(
            df, "has_recorded_advisor", {0: "No advisor on Wikidata", 1: "Advisor on Wikidata"}
        ),
        "cohort": km_curves(df, "cohort"),
        "country": km_curves(df, "country_grp", min_n=80),
        "gender": km_curves(df, "female", {0: "Male / unrecorded", 1: "Female"}),
        "top_institution": km_curves(
            df, "top_institution", {0: "Other employers", 1: "Top-25 institution"}
        ),
    }
    # Raw "percent with a major award" by group, for plain-English text
    rates = {
        "laureate_advisor": df.groupby("laureate_advisor").E.mean().to_dict(),
        "has_recorded_advisor": df.groupby("has_recorded_advisor").E.mean().to_dict(),
        "female": df.groupby("female").E.mean().to_dict(),
    }
    payload = {
        "population": {
            "n": int(len(df)),
            "events": int(df.E.sum()),
            "censored": int((1 - df.E).sum()),
            "excluded_missing_death": int(
                (
                    persons().query("is_seed and is_core_physicist").vital_status == "death_missing"
                ).sum()
            ),
            "cohorts": [COHORT_MIN, COHORT_MAX],
            "clock": f"years since birth + {PHD_AGE}",
        },
        "cox": {
            "c_index_test": float(c_cox_test),
            "c_index_train": float(cph.concordance_index_),
            "penalizer": 0.01,
            "hazard_ratios": hr,
            "ph_assumption_violations_p<0.01": ph_viol,
        },
        "rsf": rsf_res,
        "km": km,
        "event_rates": rates,
    }
    write_json("survival.json", payload)
    print(
        f"survival: n={len(df)} events={int(df.E.sum())} cox C(test)={c_cox_test:.3f} "
        f"rsf={rsf_res}"
    )
    print(s[["exp(coef)", "exp(coef) lower 95%", "exp(coef) upper 95%", "p"]].round(3).to_string())
    return 0


if __name__ == "__main__":
    sys.exit(main())
