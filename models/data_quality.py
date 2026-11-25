"""Model 7: likely Wikidata errors = explicit rules + isolation forest.

Each seed person gets a rule score (sum of rule weights) and an Isolation Forest
anomaly score over numeric record features. The final ranking is
rule_score + 2 * normalised IF score. Each item links straight to Wikidata.
"""

from __future__ import annotations

import sys

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

from models.common import CURRENT_YEAR, RNG_SEED, persons, table, wikidata_url, write_json

RULES = {
    "death_before_birth": (5, "Death date is before birth date"),
    "lifespan_over_110": (4, "Recorded lifespan over 110 years"),
    "alive_over_110": (3, "No death date but would be over 110 today"),
    "death_missing_pre1910": (2, "Born before 1910 with no death date"),
    "student_older_than_advisor": (4, "A doctoral student born before their advisor"),
    "advisor_gap_under_12": (2, "Advisor less than 12 years older than a student"),
    "award_before_15": (3, "Award received before age 15"),
    "award_long_after_death": (2, "Award dated more than 5 years after death"),
    "conflicting_dates": (2, "Several different birth/death dates on Wikidata"),
    "fictional": (5, "Description says fictional / legendary"),
    "employment_before_birth": (3, "Employment starts before age 14"),
    "bce_with_modern_links": (3, "BCE birth but modern employer/award"),
}


def main() -> int:
    p = persons().set_index("qid")
    seed = p[p.is_seed].copy()
    by, dy = seed.birth_year.astype("Float64"), seed.death_year.astype("Float64")
    flags = pd.DataFrame(index=seed.index)
    flags["death_before_birth"] = (dy < by).fillna(False)
    flags["lifespan_over_110"] = ((dy - by) > 110).fillna(False)
    flags["alive_over_110"] = (dy.isna() & ((CURRENT_YEAR - by) > 110) & (by >= 1910)).fillna(False)
    flags["death_missing_pre1910"] = seed.death_missing_suspect
    flags["conflicting_dates"] = seed.has_conflict
    flags["fictional"] = seed.description.fillna("").str.contains(
        r"fictional|legendary|mythical|mythological", case=False
    )

    adv = table("edges_advised")
    pb = p.birth_year.astype("Float64")
    adv = adv.assign(gap=adv.student.map(pb) - adv.advisor.map(pb))
    bad_adv = adv[adv.gap < 0]
    small_gap = adv[(adv.gap >= 0) & (adv.gap < 12)]
    flags["student_older_than_advisor"] = seed.index.isin(bad_adv.student) | seed.index.isin(
        bad_adv.advisor
    )
    flags["advisor_gap_under_12"] = seed.index.isin(small_gap.student)

    aw = table("edges_award")
    aw = aw.assign(
        age=aw.year - aw.person.map(pb),
        after=aw.year - aw.person.map(p.death_year.astype("Float64")),
    )
    flags["award_before_15"] = seed.index.isin(aw.loc[aw.age < 15, "person"])
    flags["award_long_after_death"] = seed.index.isin(aw.loc[aw.after > 5, "person"])
    emp = table("edges_employer")
    emp = emp.assign(age=emp.start_year - emp.person.map(pb))
    flags["employment_before_birth"] = seed.index.isin(emp.loc[emp.age < 14, "person"])
    modern = set(emp.loc[emp.start_year > 1500, "person"]) | set(aw.loc[aw.year > 1500, "person"])
    flags["bce_with_modern_links"] = (by < 0).fillna(False) & seed.index.isin(modern)
    flags = flags.fillna(False).astype(bool)

    w = pd.Series({k: v[0] for k, v in RULES.items()})
    rule_score = flags[w.index].astype(int).mul(w).sum(axis=1)

    # ---- isolation forest over record features ---------------------------------------
    n_emp = emp.groupby("person").size()
    first_award_age = aw.groupby("person").age.min()
    feats = pd.DataFrame(
        {
            "birth_year": by.fillna(by.median()),
            "lifespan": (dy - by).fillna((dy - by).median()),
            "birth_missing": by.isna().astype(int),
            "year_precision": (seed.birth_precision == "year").astype(int),
            "log_sitelinks": np.log1p(seed.sitelinks.astype("Float64").fillna(0)),
            "n_awards": seed.n_awards,
            "n_employers": pd.to_numeric(seed.index.map(n_emp), errors="coerce"),
            "n_students": seed.n_students,
            "n_advisors": seed.n_advisors,
            "first_award_age": pd.to_numeric(seed.index.map(first_award_age), errors="coerce"),
        }
    ).astype(float)
    feats["n_employers"] = feats.n_employers.fillna(0)
    feats["first_award_age"] = feats.first_award_age.fillna(feats.first_award_age.median())
    iso = IsolationForest(n_estimators=400, contamination="auto", random_state=RNG_SEED)
    iso.fit(feats)
    raw = -iso.score_samples(feats)
    if_score = (raw - raw.min()) / (raw.max() - raw.min())
    total = rule_score + 2 * if_score

    def reason_list(q):
        return [RULES[k][1] for k in RULES if flags.at[q, k]]

    order = total.sort_values(ascending=False).index
    items = []
    for q in order[:1000]:
        items.append(
            {
                "qid": q,
                "name": seed.at[q, "name"],
                "description": seed.at[q, "description"],
                "birth_year": seed.at[q, "birth_year"],
                "death_year": seed.at[q, "death_year"],
                "score": float(total[q]),
                "rule_score": int(rule_score[q]),
                "if_score": float(if_score[seed.index.get_loc(q)]),
                "rules": [k for k in RULES if flags.at[q, k]],
                "reasons": reason_list(q),
                "url": wikidata_url(q),
            }
        )
    summary = {
        "people": int(len(seed)),
        "multi_statement": int(seed.multi_statement.sum()),
        "conflicts": int(seed.has_conflict.sum()),
        "year_only_births": int((seed.birth_precision == "year").sum()),
        "missing_births": int(seed.birth_year.isna().sum()),
        "missing_deaths": int(seed.death_year.isna().sum()),
        "death_missing_pre1910": int(seed.death_missing_suspect.sum()),
        "implausible_lifespans": int(seed.lifespan_implausible.sum()),
        "bce_births": int((by < 0).sum()),
        "not_core_physicists": int((~seed.is_core_physicist).sum()),
        "rule_counts": {k: int(flags[k].sum()) for k in RULES},
        "flagged_by_any_rule": int((rule_score > 0).sum()),
    }
    payload = {
        "summary": summary,
        "rules": {k: {"weight": v[0], "text": v[1]} for k, v in RULES.items()},
        "items": items,
    }
    write_json("data_quality.json", payload)
    print(f"data quality: {summary}")
    for it in items[:8]:
        print(f"  {it['score']:.2f} {it['name']} {it['reasons']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
