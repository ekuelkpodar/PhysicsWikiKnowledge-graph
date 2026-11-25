"""GraphRAG eval: 30 questions, ground truth from DuckDB (SQL over the same Parquet graph).

For each question we compare the *set* of answer values (QIDs or a scalar) produced by
the LLM-generated Cypher against the DuckDB ground truth.
  correct  = exact set match (scalars: equal)
  f1       = set F1 (partial credit, reported alongside)

  python -m api.eval --oracle   # runs the hand-written gold Cypher instead of the LLM:
                                # checks the Kùzu load + harness agree with DuckDB (no API key needed)
  python -m api.eval            # runs the LLM (needs ANTHROPIC_API_KEY; MODEL optional)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[1]
QUESTIONS = ROOT / "api/eval_questions.json"
RESULTS = ROOT / "api/eval_results.json"
DUCK = ROOT / "data/graph/graph.duckdb"
QID = re.compile(r"^Q\d+$")


def values_from_rows(rows: list[list], kind: str) -> set:
    if kind == "scalar":
        for r in rows:
            for v in r:
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    return {round(float(v), 3)}
        return set()
    return {v for r in rows for v in r if isinstance(v, str) and QID.match(v)}


def f1(pred: set, gold: set) -> float:
    if not pred and not gold:
        return 1.0
    tp = len(pred & gold)
    if tp == 0:
        return 0.0
    p, r = tp / len(pred), tp / len(gold)
    return 2 * p * r / (p + r)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--oracle", action="store_true", help="use gold Cypher instead of the LLM")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    from api.text2cypher import MODEL, GraphQA, guard

    items = json.loads(QUESTIONS.read_text())
    if args.limit:
        items = items[: args.limit]
    con = duckdb.connect(str(DUCK), read_only=True)
    qa = GraphQA(client=None) if not args.oracle else None
    if args.oracle:
        import kuzu

        from api.text2cypher import DB_PATH

        conn = kuzu.Connection(kuzu.Database(str(DB_PATH), read_only=True))

    out = []
    t0 = time.time()
    for it in items:
        gold_rows = con.execute(it["sql"]).fetchall()
        gold = values_from_rows([list(r) for r in gold_rows], it["kind"])
        rec = {"id": it["id"], "question": it["question"], "kind": it["kind"], "n_gold": len(gold)}
        try:
            if args.oracle:
                res = conn.execute(guard(it["gold_cypher"]))
                rows = []
                while res.has_next():
                    rows.append(res.get_next())
                rec["cypher"] = it["gold_cypher"]
                rec["attempts"] = 1
            else:
                r = qa.ask(it["question"], answer=False)
                if r.error:
                    raise RuntimeError(r.error)
                rows, rec["cypher"], rec["attempts"] = r.rows, r.cypher, r.attempts
            pred = values_from_rows(rows, it["kind"])
            rec["correct"] = pred == gold
            rec["f1"] = f1(pred, gold)
            rec["n_pred"] = len(pred)
        except Exception as exc:  # noqa: BLE001 - record every failure
            rec.update(correct=False, f1=0.0, error=str(exc)[:300])
        out.append(rec)
        mark = "✓" if rec["correct"] else "✗"
        print(
            f"{mark} [{it['id']:>2}] f1={rec['f1']:.2f} gold={len(gold)} {it['question'][:70]}"
            + (f"  ERR {rec.get('error', '')[:80]}" if "error" in rec else "")
        )
    acc = sum(r["correct"] for r in out) / len(out)
    mf1 = sum(r["f1"] for r in out) / len(out)
    summary = {
        "mode": "oracle" if args.oracle else "llm",
        "model": "gold-cypher" if args.oracle else MODEL,
        "n": len(out),
        "accuracy": acc,
        "mean_f1": mf1,
        "retried": sum(1 for r in out if r.get("attempts", 1) > 1),
        "seconds": round(time.time() - t0, 1),
        "results": out,
    }
    target = RESULTS if not args.oracle else RESULTS.with_name("eval_oracle_results.json")
    target.write_text(json.dumps(summary, indent=1, default=str))
    print(
        f"\n{summary['mode']}: accuracy {acc:.1%}, mean F1 {mf1:.3f} over {len(out)} questions -> {target.name}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
