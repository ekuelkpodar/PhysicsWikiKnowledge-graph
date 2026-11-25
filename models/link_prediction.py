"""Model 2: predict missing ADVISED (advisor -> student) links.

Heterogeneous graph: person, institution, award, field nodes. Edges: employer, educated,
award, field, advised (train split only), influenced_by. P1066 "student of" is
deliberately kept OUT of training so it can act as independent corroboration of
predictions.

Models compared on the same 10% held-out ADVISED edges:
  * features-only logistic regression (shared institution, field, age gap, ...)
  * node2vec (p=q=1, i.e. DeepWalk) embeddings + the same features -> logistic regression
  * GraphSAGE (PyTorch Geometric), if torch is installed
Metrics: ROC-AUC and AP on pos vs matched negatives (half random, half hard
same-institution negatives), Hits@10 ranking the true advisor against 100 random
people, and Hits@10 against plausible candidates (same institution, 15-45y older).
"""

from __future__ import annotations

import sys
import time
from collections import defaultdict

import numpy as np
import pandas as pd
from gensim.models import Word2Vec
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from models.common import RNG_SEED, employment_spans, persons, table, wikidata_url, write_json

DIM = 64
WALK_LEN = 30
WALKS_PER_NODE = 10
N_RANK_NEG = 100
TOP_K = 200

rng = np.random.default_rng(RNG_SEED)


# ---------------------------------------------------------------- context data
class Context:
    """Per-person lookups used for pair features and evidence."""

    def __init__(self):
        p = persons().set_index("qid")
        self.p = p
        self.birth = p.birth_year.astype("Float64").to_dict()
        emp = employment_spans()
        edu = table("edges_educated").copy()
        by = edu.person.map(p.birth_year).astype("Float64")
        edu["start"] = edu.start_year.astype("Float64").fillna(by + 18)
        edu["end"] = edu.end_year.astype("Float64").fillna(edu["start"] + 8)
        self.emp = defaultdict(list)
        for r in emp.itertuples():
            self.emp[r.person].append((r.institution, float(r.start), float(r.end)))
        self.edu = defaultdict(list)
        for r in edu.dropna(subset=["start"]).itertuples():
            self.edu[r.person].append((r.institution, float(r.start), float(r.end)))
        self.any_inst = defaultdict(set)
        for d in (self.emp, self.edu):
            for k, v in d.items():
                self.any_inst[k] |= {i for i, *_ in v}
        f = table("edges_field")
        self.fields = f.groupby("person")["field"].agg(set).to_dict()
        self.inst_label = table("nodes_institution").set_index("qid")["label"].to_dict()
        self.field_label = table("nodes_field").set_index("qid")["label"].to_dict()
        self.laureate = p.is_laureate.to_dict()
        # people per institution (employment) for candidate generation / hard negatives
        self.staff = defaultdict(set)
        for k, v in self.emp.items():
            for i, *_ in v:
                self.staff[i].add(k)

    def evidence(self, a: str, s: str) -> dict:
        """Advisor a employed at an institution while student s studied/worked there."""
        shared = []
        for ia, sa, ea in self.emp.get(a, []):
            for is_, ss, es in self.edu.get(s, []) + self.emp.get(s, []):
                if ia == is_ and sa <= es + 2 and ss <= ea + 2:
                    shared.append((ia, int(max(sa, ss)), int(min(ea, es))))
        ba, bs = self.birth.get(a), self.birth.get(s)
        gap = None if (pd.isna(ba) or pd.isna(bs)) else int(bs - ba)
        fields = self.fields.get(a, set()) & self.fields.get(s, set())
        return {
            "shared_institutions": [
                {"qid": i, "label": self.inst_label.get(i), "from": f, "to": t}
                for i, f, t in sorted(set(shared), key=lambda x: x[1])[:3]
            ],
            "shared_fields": [self.field_label.get(x) for x in sorted(fields)][:4],
            "age_gap": gap,
            "age_gap_plausible": gap is not None and 15 <= gap <= 45,
        }

    def pair_features(self, a: str, s: str, adv_deg: dict) -> list[float]:
        ev = self.evidence(a, s)
        gap = ev["age_gap"]
        any_shared = len(self.any_inst.get(a, set()) & self.any_inst.get(s, set()))
        return [
            float(len(ev["shared_institutions"]) > 0),
            float(any_shared),
            float(len(ev["shared_fields"])),
            float(gap is not None),
            float(ev["age_gap_plausible"]),
            0.0 if gap is None else min(abs(gap - 30), 60) / 60,
            np.log1p(adv_deg.get(a, 0)),
            float(self.laureate.get(a, False)),
        ]


FEATURE_NAMES = [
    "shared_inst_overlap",
    "n_shared_inst_any",
    "n_shared_fields",
    "both_birth_known",
    "age_gap_15_45",
    "age_gap_dev_30",
    "log_advisor_train_degree",
    "advisor_is_laureate",
]


# ---------------------------------------------------------------- graph + walks
def hetero_edges(train_adv: pd.DataFrame) -> list[tuple[str, str]]:
    edges = list(zip(train_adv.advisor, train_adv.student))
    for t, a, b in [
        ("edges_employer", "person", "institution"),
        ("edges_educated", "person", "institution"),
        ("edges_award", "person", "award"),
        ("edges_field", "person", "field"),
    ]:
        df = table(t)
        edges += list(zip(df[a], df[b]))
    inf = table("edges_influenced_by")
    inf = inf[inf.influencer_in_graph]
    edges += list(zip(inf.person, inf.influencer))
    return edges


def random_walks(edges, walk_len=WALK_LEN, per_node=WALKS_PER_NODE):
    nodes = sorted({x for e in edges for x in e})
    idx = {n: i for i, n in enumerate(nodes)}
    src = np.array([idx[a] for a, b in edges] + [idx[b] for a, b in edges])
    dst = np.array([idx[b] for a, b in edges] + [idx[a] for a, b in edges])
    order = np.argsort(src, kind="stable")
    src, dst = src[order], dst[order]
    indptr = np.zeros(len(nodes) + 1, dtype=np.int64)
    np.add.at(indptr, src + 1, 1)
    indptr = np.cumsum(indptr)
    deg = np.diff(indptr)
    starts = np.repeat(np.arange(len(nodes)), per_node)
    rng.shuffle(starts)
    walks = np.empty((len(starts), walk_len), dtype=np.int64)
    walks[:, 0] = cur = starts
    for t in range(1, walk_len):
        d = deg[cur]
        off = (rng.random(len(cur)) * np.maximum(d, 1)).astype(np.int64)
        nxt = np.where(d > 0, dst[np.minimum(indptr[cur] + off, len(dst) - 1)], cur)
        walks[:, t] = cur = nxt
    return nodes, walks


def train_embeddings(edges) -> dict[str, np.ndarray]:
    nodes, walks = random_walks(edges)
    sentences = [[nodes[i] for i in w] for w in walks]
    model = Word2Vec(
        sentences,
        vector_size=DIM,
        window=5,
        min_count=1,
        sg=1,
        negative=5,
        epochs=2,
        workers=1,  # single thread => deterministic embeddings
        seed=RNG_SEED,
    )
    return {n: model.wv[n] for n in nodes}


# ---------------------------------------------------------------- sampling
def sample_negatives(pos: pd.DataFrame, ctx: Context, people: np.ndarray, known: set):
    """One random + one hard (shares an institution with the student) negative per pos."""
    out = []
    for s in pos.student:
        for hard in (False, True):
            cand = None
            if hard:
                pool = set()
                for i in ctx.any_inst.get(s, set()):
                    pool |= ctx.staff.get(i, set())
                pool = [c for c in pool if c != s and (c, s) not in known]
                if pool:
                    cand = pool[rng.integers(len(pool))]
            while cand is None or cand == s or (cand, s) in known:
                cand = people[rng.integers(len(people))]
            out.append((cand, s, int(hard)))
    return pd.DataFrame(out, columns=["advisor", "student", "hard"])


def build_X(pairs, ctx, emb, adv_deg, use_emb=True):
    rows = []
    zero = np.zeros(DIM, dtype=np.float32)
    for a, s in pairs:
        f = ctx.pair_features(a, s, adv_deg)
        if use_emb:
            ea, es = emb.get(a, zero), emb.get(s, zero)
            na, ns = np.linalg.norm(ea), np.linalg.norm(es)
            cos = float(ea @ es / (na * ns)) if na > 0 and ns > 0 else 0.0
            f = f + [cos] + list(ea * es)
        rows.append(f)
    return np.asarray(rows, dtype=np.float32)


def hits_at_k(score_fn, test_pos, people, k=10, cand_fn=None):
    hits, n = 0, 0
    for a, s in test_pos:
        if cand_fn is not None:
            negs = cand_fn(a, s)
            if len(negs) < 5:
                continue
        else:
            negs = list(people[rng.integers(len(people), size=N_RANK_NEG)])
        negs = [c for c in negs if c != a and c != s][:N_RANK_NEG]
        scores = score_fn([(a, s)] + [(c, s) for c in negs])
        rank = 1 + int((scores[1:] > scores[0]).sum())
        hits += rank <= k
        n += 1
    return hits / max(n, 1), n


# ---------------------------------------------------------------- GraphSAGE
def graphsage_scores(train_adv, test_pairs, ctx, extra_pairs=None, epochs=150):
    """Returns (scores for test_pairs, scores for extra_pairs) or None if PyG missing."""
    try:
        import torch
        import torch.nn.functional as F
        from torch_geometric.nn import SAGEConv
    except Exception as exc:  # pragma: no cover - optional dependency
        print(f"  GraphSAGE skipped: {exc}")
        return None
    torch.manual_seed(RNG_SEED)
    edges = hetero_edges(train_adv)
    nodes = sorted({x for e in edges for x in e} | {x for pr in test_pairs for x in pr})
    if extra_pairs:
        nodes = sorted(set(nodes) | {x for pr in extra_pairs for x in pr})
    nodes = sorted(set(nodes) | set(persons().qid))  # ranking/candidates may touch anyone
    idx = {n: i for i, n in enumerate(nodes)}
    ptype = {q: 0 for q in persons().qid}
    for t, k in [("nodes_institution", 1), ("nodes_award", 2), ("nodes_field", 3)]:
        for q in table(t).qid:
            ptype.setdefault(q, k)
    x = np.zeros((len(nodes), 8), dtype=np.float32)
    deg = defaultdict(int)
    for a, b in edges:
        deg[a] += 1
        deg[b] += 1
    for n, i in idx.items():
        x[i, ptype.get(n, 0)] = 1
        x[i, 4] = np.log1p(deg[n])
        b = ctx.birth.get(n)
        x[i, 5] = 0 if b is None or pd.isna(b) else (b - 1900) / 100
        x[i, 6] = float(b is not None and not pd.isna(b))
        x[i, 7] = float(ctx.laureate.get(n, False))
    ei = torch.tensor(
        [
            [idx[a] for a, b in edges] + [idx[b] for a, b in edges],
            [idx[b] for a, b in edges] + [idx[a] for a, b in edges],
        ],
        dtype=torch.long,
    )
    X = torch.tensor(x)

    class Net(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.c1 = SAGEConv(8, 64)
            self.c2 = SAGEConv(64, 64)
            self.dec = torch.nn.Sequential(
                torch.nn.Linear(64 * 2 + len(FEATURE_NAMES), 64),
                torch.nn.ReLU(),
                torch.nn.Linear(64, 1),
            )

        def encode(self):
            h = F.relu(self.c1(X, ei))
            return self.c2(h, ei)

        def decode(self, h, a, s, f):
            return self.dec(torch.cat([h[a] * h[s], (h[a] - h[s]).abs(), f], dim=1)).squeeze(-1)

    adv_deg = train_adv.advisor.value_counts().to_dict()
    known = set(zip(train_adv.advisor, train_adv.student))
    people = np.array([n for n in nodes if ptype.get(n) == 0])
    net = Net()
    opt = torch.optim.Adam(net.parameters(), lr=0.01, weight_decay=1e-5)
    pos = list(zip(train_adv.advisor, train_adv.student))

    def feats(pairs):
        return torch.tensor(
            [ctx.pair_features(a, s, adv_deg) for a, s in pairs], dtype=torch.float32
        )

    pos_f = feats(pos)
    for ep in range(epochs):
        net.train()
        if ep % 10 == 0:  # refresh negatives
            neg_df = sample_negatives(train_adv, ctx, people, known)
            neg = list(zip(neg_df.advisor, neg_df.student))
            neg_f = feats(neg)
        opt.zero_grad()
        h = net.encode()
        pa = torch.tensor([idx[a] for a, s in pos])
        ps = torch.tensor([idx[s] for a, s in pos])
        na = torch.tensor([idx[a] for a, s in neg])
        ns = torch.tensor([idx[s] for a, s in neg])
        lp = net.decode(h, pa, ps, pos_f)
        ln = net.decode(h, na, ns, neg_f)
        loss = F.binary_cross_entropy_with_logits(
            torch.cat([lp, ln]), torch.cat([torch.ones_like(lp), torch.zeros_like(ln)])
        )
        loss.backward()
        opt.step()
    net.eval()
    with torch.no_grad():
        h = net.encode()

        def score(pairs):
            if not pairs:
                return np.array([])
            a = torch.tensor([idx[p[0]] for p in pairs])
            s = torch.tensor([idx[p[1]] for p in pairs])
            with torch.no_grad():
                return torch.sigmoid(net.decode(h, a, s, feats(pairs))).detach().numpy()

        return score


# ---------------------------------------------------------------- main
def main() -> int:
    t0 = time.time()
    ctx = Context()
    p = ctx.p
    adv = table("edges_advised")[["advisor", "student"]].copy()
    adv = adv[adv.advisor.isin(p.index) & adv.student.isin(p.index)].reset_index(drop=True)
    perm = rng.permutation(len(adv))
    n_test = len(adv) // 10
    test = adv.iloc[perm[:n_test]].reset_index(drop=True)
    train = adv.iloc[perm[n_test:]].reset_index(drop=True)
    known_all = set(zip(adv.advisor, adv.student))
    people = p.index[p.birth_year.notna()].to_numpy()
    adv_deg = train.advisor.value_counts().to_dict()
    print(f"advised edges: {len(adv):,} (train {len(train):,} / test {len(test):,})")

    emb = train_embeddings(hetero_edges(train))
    print(f"  embeddings: {len(emb):,} nodes in {time.time() - t0:.0f}s")

    tr_neg = sample_negatives(train, ctx, people, known_all)
    te_neg = sample_negatives(test, ctx, people, known_all)
    tr_pairs = list(zip(train.advisor, train.student)) + list(zip(tr_neg.advisor, tr_neg.student))
    te_pairs = list(zip(test.advisor, test.student)) + list(zip(te_neg.advisor, te_neg.student))
    y_tr = np.r_[np.ones(len(train)), np.zeros(len(tr_neg))]
    y_te = np.r_[np.ones(len(test)), np.zeros(len(te_neg))]
    hard_mask = np.r_[np.zeros(len(test), bool), te_neg.hard.to_numpy().astype(bool)]

    def plausible_candidates(a, s):
        pool = set()
        for i in ctx.any_inst.get(s, set()):
            pool |= ctx.staff.get(i, set())
        bs = ctx.birth.get(s)
        out = []
        for c in pool:
            bc = ctx.birth.get(c)
            if c in (a, s) or bc is None or pd.isna(bc) or bs is None or pd.isna(bs):
                continue
            if 15 <= bs - bc <= 45:
                out.append(c)
        return out

    results = {}
    scorers = {}
    for name, use_emb in [("features_lr", False), ("node2vec_lr", True)]:
        clf = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000, C=1.0))
        clf.fit(build_X(tr_pairs, ctx, emb, adv_deg, use_emb), y_tr)
        prob = clf.predict_proba(build_X(te_pairs, ctx, emb, adv_deg, use_emb))[:, 1]

        def score_fn(pairs, clf=clf, use_emb=use_emb):
            return clf.predict_proba(build_X(pairs, ctx, emb, adv_deg, use_emb))[:, 1]

        scorers[name] = (clf, use_emb)
        h10, n_r = hits_at_k(score_fn, list(zip(test.advisor, test.student)), people)
        h10p, n_p = hits_at_k(
            score_fn, list(zip(test.advisor, test.student)), people, cand_fn=plausible_candidates
        )
        hard_sel = np.r_[np.ones(len(test), bool), hard_mask[len(test) :]]
        results[name] = {
            "auc": roc_auc_score(y_te, prob),
            "ap": average_precision_score(y_te, prob),
            "auc_hard_negatives_only": roc_auc_score(y_te[hard_sel], prob[hard_sel]),
            "hits@10_vs_100_random": h10,
            "hits@10_vs_plausible": h10p,
            "n_rank_queries_plausible": n_p,
        }
        print(f"  {name}: {results[name]}")

    sage = graphsage_scores(train, te_pairs, ctx)
    if sage is not None:
        prob = sage(te_pairs)
        hard_sel = np.r_[np.ones(len(test), bool), hard_mask[len(test) :]]
        h10, _ = hits_at_k(sage, list(zip(test.advisor, test.student)), people)
        h10p, n_p = hits_at_k(
            sage, list(zip(test.advisor, test.student)), people, cand_fn=plausible_candidates
        )
        results["graphsage"] = {
            "auc": roc_auc_score(y_te, prob),
            "ap": average_precision_score(y_te, prob),
            "auc_hard_negatives_only": roc_auc_score(y_te[hard_sel], prob[hard_sel]),
            "hits@10_vs_100_random": h10,
            "hits@10_vs_plausible": h10p,
            "n_rank_queries_plausible": n_p,
        }
        print(f"  graphsage: {results['graphsage']}")

    best = max(results, key=lambda k: results[k]["ap"])
    print(f"  best by AP: {best}")

    # ---- predictions: seed people with no recorded advisor ------------------------
    # Refit the chosen LR on all known edges (embeddings stay train-only: conservative).
    all_neg = sample_negatives(adv, ctx, people, known_all)
    all_pairs = list(zip(adv.advisor, adv.student)) + list(zip(all_neg.advisor, all_neg.student))
    y_all = np.r_[np.ones(len(adv)), np.zeros(len(all_neg))]
    adv_deg_all = adv.advisor.value_counts().to_dict()
    lr_name = "node2vec_lr" if best == "graphsage" else best
    _, use_emb = scorers[lr_name]
    final = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000))
    final.fit(build_X(all_pairs, ctx, emb, adv_deg_all, use_emb), y_all)

    has_adv = set(adv.student)
    targets = p[p.is_seed & ~p.index.isin(has_adv) & (p.birth_year >= 1780)].index
    cands = []
    for s in targets:
        for c in plausible_candidates(None, s):
            if (c, s) in known_all or (s, c) in known_all:
                continue
            if ctx.evidence(c, s)["shared_institutions"]:
                cands.append((c, s))
    cands = list(dict.fromkeys(cands))
    print(f"  candidate pairs: {len(cands):,} for {len(targets):,} advisor-less seed people")
    score = final.predict_proba(build_X(cands, ctx, emb, adv_deg_all, use_emb))[:, 1]
    if sage is not None and best == "graphsage":
        score = 0.5 * score + 0.5 * sage(cands)
    pred = pd.DataFrame(cands, columns=["advisor", "student"])
    pred["score"] = score
    # Keep the best candidate per student first, so the list isn't 10 guesses for one person.
    pred = pred.sort_values("score", ascending=False)
    pred["rank_for_student"] = pred.groupby("student").cumcount() + 1
    top = pred[pred.rank_for_student <= 2].head(TOP_K).copy()
    p1066 = table("edges_student_of")
    so = set(zip(p1066.teacher, p1066.student))
    so_by: dict[str, set] = {}
    for t, s_ in so:
        so_by.setdefault(s_, set()).add(t)
    out = []
    for r in top.itertuples():
        ev = ctx.evidence(r.advisor, r.student)
        out.append(
            {
                "advisor": r.advisor,
                "advisor_name": p.at[r.advisor, "name"],
                "student": r.student,
                "student_name": p.at[r.student, "name"],
                "score": float(r.score),
                "rank_for_student": int(r.rank_for_student),
                "corroborated_p1066": (r.advisor, r.student) in so,
                "advisor_url": wikidata_url(r.advisor),
                "student_url": wikidata_url(r.student),
                **ev,
            }
        )
    corroborated = sum(o["corroborated_p1066"] for o in out)
    # External validation: for advisor-less students whose P1066 "student of" teacher is
    # among their candidates, how often does the model rank that teacher first / top-3?
    ext = {"students_evaluable": 0, "hit@1": 0, "hit@3": 0}
    for st, g in pred.groupby("student"):
        teachers = so_by.get(st, set())
        if not teachers or not set(g.advisor) & teachers:
            continue
        ext["students_evaluable"] += 1
        ranked = g.sort_values("score", ascending=False).advisor.tolist()
        ext["hit@1"] += ranked[0] in teachers
        ext["hit@3"] += bool(set(ranked[:3]) & teachers)
    n_ev = max(ext["students_evaluable"], 1)
    ext["hit@1_rate"] = ext["hit@1"] / n_ev
    ext["hit@3_rate"] = ext["hit@3"] / n_ev
    ext["mean_candidates_per_student"] = float(pred.groupby("student").size().mean())
    print(f"  P1066 external check: {ext}")
    clf_lr = final.named_steps["logisticregression"]
    coefs = dict(zip(FEATURE_NAMES, clf_lr.coef_[0][: len(FEATURE_NAMES)].tolist()))
    payload = {
        "metrics": results,
        "best_model": best,
        "split": {"train": len(train), "test": len(test), "negatives_per_positive": 2},
        "embedding": {
            "method": "node2vec p=q=1 (DeepWalk)",
            "dim": DIM,
            "walk_len": WALK_LEN,
            "walks_per_node": WALKS_PER_NODE,
        },
        "feature_coefficients": coefs,
        "n_candidates": len(cands),
        "n_targets": int(len(targets)),
        "top_corroborated_by_p1066": corroborated,
        "p1066_external_check": ext,
        "predictions": out,
    }
    write_json("link_predictions.json", payload)
    print(
        f"  top-{len(out)} written; {corroborated} corroborated by P1066; {time.time() - t0:.0f}s"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
