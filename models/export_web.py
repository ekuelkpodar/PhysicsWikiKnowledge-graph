"""Export compact, chunked JSON for the static web app (web/public/data/).

Also writes data/models/layout_input.json, consumed by web/scripts/layout.mjs
(ForceAtlas2 in graphology), which produces web/public/data/layout.json.
"""

from __future__ import annotations

import json
import math
import shutil
import sys
from datetime import date
from urllib.parse import unquote

import numpy as np
import pandas as pd

from models.common import OUT, ROOT, _clean, read_json, table

WEB = ROOT / "web/public/data"
CHUNK = 500


def dump(name: str, obj) -> int:
    p = WEB / name
    p.parent.mkdir(parents=True, exist_ok=True)
    s = json.dumps(_clean(obj), separators=(",", ":"), ensure_ascii=False)
    p.write_text(s)
    return len(s)


def iv(x):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) or x is pd.NA else int(x)


def main() -> int:
    if WEB.exists():
        shutil.rmtree(WEB)
    WEB.mkdir(parents=True)
    P = table("nodes_person").copy()
    P["qnum"] = P.qid.str[1:].astype(int)
    P = P.sort_values(["is_seed", "qnum"], ascending=[False, True]).reset_index(drop=True)
    idx = {q: i for i, q in enumerate(P.qid)}
    n = len(P)

    gm = pd.DataFrame(read_json("genealogy_metrics.json")["per_person"]).set_index("qid")
    fields = read_json("fields_alluvial.json")
    dq = read_json("data_quality.json")
    links = read_json("link_predictions.json")
    surv = read_json("survival.json")
    mig = read_json("migration.json")
    inst_bump = read_json("institutions_bump.json")
    gen = read_json("genealogy_metrics.json")

    quality_reasons = {it["qid"]: it["reasons"] for it in dq["items"] if it["rule_score"] > 0}
    countries = sorted(P.country.dropna().unique().tolist())
    cidx = {c: i for i, c in enumerate(countries)}
    genders = sorted(P.gender.dropna().unique().tolist())
    gidx = {g: i for i, g in enumerate(genders)}
    pc = fields["person_community"]

    def flags(r) -> int:
        f = 0
        f |= 1 if r.is_seed else 0
        f |= 2 if r.is_core_physicist else 0
        f |= 4 if r.is_laureate else 0
        f |= 8 if r.is_nobel else 0
        f |= 16 if r.has_conflict else 0
        f |= 32 if r.death_missing_suspect else 0
        f |= 64 if r.qid in quality_reasons else 0
        f |= 128 if isinstance(r.image, str) else 0
        f |= 256 if r.birth_precision == "year" else 0
        return f

    bp_code = {"missing": 0, "year": 1, "day": 2, "month": 2}
    img = P.image.map(lambda u: unquote(u.split("FilePath/", 1)[1]) if isinstance(u, str) else "")
    people = {
        "n": n,
        "id": P.qid.tolist(),
        "name": P.name.tolist(),
        "by": [iv(x) for x in P.birth_year],
        "dy": [iv(x) for x in P.death_year],
        "bp": [bp_code.get(x, 3) for x in P.birth_precision],
        "f": [flags(r) for r in P.itertuples()],
        "c": [cidx.get(c, -1) if isinstance(c, str) else -1 for c in P.country],
        "countries": countries,
        "gd": [gidx.get(g, -1) if isinstance(g, str) else -1 for g in P.gender],
        "genders": genders,
        "fc": [int(pc.get(q, -1)) for q in P.qid],
        "communities": fields["global_communities"],
        "d": [int(gm.descendants.get(q, 0)) for q in P.qid],
        "dl": [int(gm.descendant_laureates.get(q, 0)) for q in P.qid],
        "g": [int(gm.generation.get(q, 0)) for q in P.qid],
        "pr": [int(round(1000 * gm.pagerank_pct.get(q, 0))) for q in P.qid],
        "img": [],  # filled from images.json after first paint (lazy)
        "aw": [iv(x) for x in P.first_major_award_year],
    }
    sizes = {"people.json": dump("people.json", people)}
    sizes["images.json"] = dump("images.json", {"img": img.tolist()})
    sizes["geo.json"] = dump(
        "geo.json",
        {
            "lat": [None if pd.isna(x) else round(float(x), 2) for x in P.birth_lat],
            "lon": [None if pd.isna(x) else round(float(x), 2) for x in P.birth_lon],
        },
    )

    adv = table("edges_advised")
    adv = adv[adv.advisor.isin(idx) & adv.student.isin(idx)]
    flat = np.column_stack([adv.advisor.map(idx), adv.student.map(idx)]).ravel().tolist()
    preds = links["predictions"]
    pflat = []
    for pr in preds:
        if pr["advisor"] in idx and pr["student"] in idx:
            pflat += [idx[pr["advisor"]], idx[pr["student"]], int(round(pr["score"] * 1000))]
    sizes["edges.json"] = dump("edges.json", {"advised": flat, "predicted": pflat})

    # --- layout input: person-person + person-institution anchor edges --------------
    emp = pd.concat(
        [
            table("edges_employer")[["person", "institution"]],
            table("edges_educated")[["person", "institution"]],
        ]
    )
    emp = emp[emp.person.isin(idx)].drop_duplicates()
    inst_ids = {q: n + k for k, q in enumerate(sorted(emp.institution.unique()))}
    lay_edges = [[a, b, 3.0] for a, b in zip(adv.advisor.map(idx), adv.student.map(idx))]
    lay_edges += [[idx[p], inst_ids[i], 1.0] for p, i in zip(emp.person, emp.institution)]
    fld = table("edges_field")
    fld = fld[fld.person.isin(idx)]
    fld_ids = {q: n + len(inst_ids) + k for k, q in enumerate(sorted(fld.field.unique()))}
    lay_edges += [[idx[p], fld_ids[f], 0.5] for p, f in zip(fld.person, fld.field)]
    (OUT / "layout_input.json").write_text(
        json.dumps(
            {
                "n_people": n,
                "n_total": n + len(inst_ids) + len(fld_ids),
                "edges": lay_edges,
                "community": people["fc"] + [-1] * (len(inst_ids) + len(fld_ids)),
            }
        )
    )

    # --- person detail chunks --------------------------------------------------------
    nodes_inst = table("nodes_institution").set_index("qid")["label"]
    awards = table("edges_award").merge(
        table("nodes_award"), left_on="award", right_on="qid", how="left"
    )
    aw_by = awards.sort_values("year").groupby("person")
    empl = table("edges_employer").assign(kind="employer")
    edu = table("edges_educated").assign(kind="educated")
    ins = pd.concat([empl, edu])
    ins["label"] = ins.institution.map(nodes_inst)
    ins = ins.dropna(subset=["label"]).sort_values("start_year")
    ins_by = ins.groupby("person")
    fl = table("edges_field").merge(table("nodes_field"), left_on="field", right_on="qid")
    fl_by = fl.groupby("person")["label"].agg(list)
    wk = table("edges_notable_work").merge(table("nodes_work"), left_on="work", right_on="qid")
    wk_by = wk.groupby("person")["label"].agg(list)
    pred_by: dict[str, list] = {}
    for pr in preds:
        if pr["advisor"] in idx:
            pred_by.setdefault(pr["student"], []).append(
                {
                    "advisor": idx[pr["advisor"]],
                    "score": round(pr["score"], 3),
                    "inst": [s["label"] for s in pr["shared_institutions"] if s["label"]],
                    "fields": pr["shared_fields"],
                    "gap": pr["age_gap"],
                }
            )
    aw_groups = dict(list(aw_by))
    ins_groups = dict(list(ins_by))
    chunks: dict[int, dict] = {}
    for i, r in enumerate(P.itertuples()):
        a = aw_groups.get(r.qid)
        it = ins_groups.get(r.qid)
        chunks.setdefault(i // CHUNK, {})[r.qid] = {
            "desc": r.description if isinstance(r.description, str) else None,
            "wiki": r.wikipedia_url if isinstance(r.wikipedia_url, str) else None,
            "bd": r.birth_date if isinstance(r.birth_date, str) else None,
            "dd": r.death_date if isinstance(r.death_date, str) else None,
            "dp": r.death_precision,
            "place": r.birth_place_label if isinstance(r.birth_place_label, str) else None,
            "bcountry": r.birth_country if isinstance(r.birth_country, str) else None,
            "cit": r.citizenship if isinstance(r.citizenship, str) else None,
            "gender": r.gender if isinstance(r.gender, str) else None,
            "sitelinks": iv(r.sitelinks),
            "awards": (
                []
                if a is None
                else [
                    [lbl, iv(y), int(bool(m))]
                    for lbl, y, m in zip(a.label, a.year, a.is_major.fillna(False))
                    if isinstance(lbl, str)
                ][:30]
            ),
            "inst": (
                []
                if it is None
                else [
                    [lbl, iv(s), iv(e), k, int(pd.isna(s) or pd.isna(e))]
                    for lbl, s, e, k in zip(it.label, it.start_year, it.end_year, it.kind)
                ][:16]
            ),
            "fields": fl_by.get(r.qid, [])[:8],
            "works": wk_by.get(r.qid, [])[:6],
            "quality": quality_reasons.get(r.qid, []),
            "predicted": pred_by.get(r.qid, [])[:3],
        }
    for k, v in chunks.items():
        sizes[f"person/{k}.json"] = dump(f"person/{k}.json", v)

    # --- model outputs ---------------------------------------------------------------
    lb = []
    for row in gen["leaderboard"]:
        if row["qid"] in idx:
            lb.append(
                {
                    **{
                        k: row[k]
                        for k in [
                            "qid",
                            "name",
                            "birth_year",
                            "death_year",
                            "descendants",
                            "descendant_laureates",
                            "descendant_nobels",
                            "yield",
                            "yield_smoothed",
                            "lift",
                            "is_root",
                            "generation",
                            "subtree_height",
                        ]
                    },
                    "i": idx[row["qid"]],
                }
            )
    sizes["genealogy.json"] = dump("genealogy.json", {"summary": gen["summary"], "leaderboard": lb})
    mig = dict(mig)
    mig["arcs"] = [[idx[a[0]], *a[1:]] for a in mig["arcs"] if a[0] in idx]
    mig.pop("countries", None)
    sizes["migration.json"] = dump("migration.json", mig)
    sizes["institutions.json"] = dump("institutions.json", inst_bump)
    fa = fields["alluvial"]
    for nd in fa["nodes"]:
        nd.pop("people_qids", None)
    sizes["fields.json"] = dump(
        "fields.json", {k: v for k, v in fields.items() if k != "person_community"}
    )
    sizes["survival.json"] = dump("survival.json", surv)
    lk = {k: v for k, v in links.items() if k != "predictions"}
    lk["predictions"] = [
        {
            **pr,
            "advisor": idx[pr["advisor"]],
            "student": idx[pr["student"]],
            "advisor_qid": pr["advisor"],
            "student_qid": pr["student"],
        }
        for pr in preds
        if pr["advisor"] in idx and pr["student"] in idx
    ]
    sizes["links.json"] = dump("links.json", lk)
    sizes["quality.json"] = dump("quality.json", dq)
    sizes["model_cards.json"] = dump("model_cards.json", read_json("model_cards.json"))

    # --- meta + story numbers ------------------------------------------------------------
    seed = P[P.is_seed]
    best = links["metrics"][links["best_model"]]
    top_f = max(gen["leaderboard"], key=lambda r: r["descendants"]) if gen["leaderboard"] else None
    hr = {h["covariate"]: h for h in surv["cox"]["hazard_ratios"]}
    story = {
        "largest_component": gen["summary"]["largest_component"],
        "top_founder": top_f["name"] if top_f else "",
        "top_founder_desc": top_f["descendants"] if top_f else 0,
        "cross_border_share": mig["notes"]["n_cross_border"] / max(mig["notes"]["n_moves"], 1),
        "nazi_share": mig["curated_windows"]["nazi_era"]["share_abroad"],
        "laureate_advisor_hr": hr.get("laureate_advisor", {}).get("hr"),
        "conflicts": int(seed.has_conflict.sum()),
        "year_only": int((seed.birth_precision == "year").sum()),
        "predicted": len(lk["predictions"]),
    }
    meta = {
        "generated": date.today().isoformat(),
        "counts": {
            "people": n,
            "seed": int(len(seed)),
            "expanded": int(n - len(seed)),
            "core": int(seed.is_core_physicist.sum()),
            "laureates": int(P.is_laureate.sum()),
            "advised": len(flat) // 2,
            "predicted": len(lk["predictions"]),
        },
        "link_metrics": links["metrics"],
        "best_link_model": links["best_model"],
        "best_link": best,
        "year_min": -600,
        "year_max": 2025,
        "ask_api": None,
        "story": story,
    }
    sizes["meta.json"] = dump("meta.json", meta)
    total = sum(sizes.values())
    print(
        f"web data: {len(sizes)} files, {total / 1e6:.1f} MB raw; people.json {sizes['people.json'] / 1e6:.2f} MB"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
