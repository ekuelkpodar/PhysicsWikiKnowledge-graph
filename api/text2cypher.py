"""Natural language -> read-only Cypher over the Kùzu graph, with guardrails.

Guardrails:
  * the database is opened read-only, and write/DDL keywords are rejected before execution;
  * every query gets a LIMIT (added if missing, clamped to MAX_LIMIT);
  * a per-query timeout;
  * one retry on a Cypher error, with the error message fed back to the model.
Model comes from $MODEL (default claude-opus-5-5); key from the environment, never from disk.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

import anthropic
import kuzu

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "api/kuzu_db"
MODEL = os.environ.get("MODEL", "claude-opus-5-5")
MAX_LIMIT = 500
DEFAULT_LIMIT = 200
TIMEOUT_MS = 8000
USE_FALLBACKS = os.environ.get("FALLBACKS", "1") != "0"

SCHEMA_PROMPT = """You translate questions about physicists into a single read-only Cypher query for the Kùzu graph database.

Schema
------
(:Person {qid, name, birth_year, death_year, description, gender, birth_country, is_laureate, is_nobel, is_core, is_seed, descendants})
(:Institution {qid, name, country})
(:Award {qid, name, is_major, is_nobel})
(:Field {qid, name})
(:Country {qid, name})
(:Person)-[:ADVISED]->(:Person)                 advisor -> doctoral student
(:Person)-[:WORKED_AT {start_year, end_year}]->(:Institution)
(:Person)-[:EDUCATED_AT {start_year, end_year}]->(:Institution)
(:Person)-[:RECEIVED {year}]->(:Award)
(:Person)-[:WORKS_IN]->(:Field)
(:Person)-[:CITIZEN_OF]->(:Country)

Notes
-----
* is_laureate = holds a major award (Nobel, Wolf, Dirac, Fields, Planck Medal, ...). is_nobel = any Nobel Prize.
* The Nobel Prize in Physics is the Award with name 'Nobel Prize in Physics'.
* Names are English Wikidata labels, e.g. 'Niels Bohr', 'Max Born', 'Arnold Sommerfeld'. Some differ from common usage:
  'Joseph John Thomson' (J. J. Thomson), 'Marie Sklodowska-Curie' (Marie Curie). Match names exactly with `p.name = '...'`.
* Award labels are Wikidata's: 'Nobel Prize in Physics', 'Fields medal', 'ICTP Dirac Medal', 'IOP Dirac Medal',
  'Wolf Prize in Physics', 'Max Planck Medal', 'Copley Medal'.
* birth_country is the modern country of the birthplace, e.g. 'Germany', 'United States', 'Hungary'.
* Variable-length paths: `-[:ADVISED*1..6]->`. Kùzu requires an upper bound <= 30.
* Always RETURN p.qid (and the name) for every person you return, so the app can highlight them.
* Read-only: never use CREATE, MERGE, SET, DELETE, DROP, COPY, LOAD, INSTALL, ALTER.
* Always end with a LIMIT.

Examples
--------
Q: Who were Niels Bohr's doctoral students?
MATCH (a:Person {name: 'Niels Bohr'})-[:ADVISED]->(s:Person) RETURN s.qid, s.name, s.birth_year ORDER BY s.birth_year LIMIT 100

Q: Which Nobel laureates had a Nobel laureate as doctoral advisor?
MATCH (a:Person)-[:ADVISED]->(s:Person) WHERE a.is_nobel AND s.is_nobel RETURN a.qid, a.name AS advisor, s.qid, s.name AS student LIMIT 200

Q: How many people worked at CERN?
MATCH (p:Person)-[:WORKED_AT]->(i:Institution {name: 'CERN'}) RETURN count(DISTINCT p) AS n LIMIT 1

Q: Academic descendants of Arnold Sommerfeld who won the Nobel Prize in Physics
MATCH (a:Person {name: 'Arnold Sommerfeld'})-[:ADVISED*1..6]->(d:Person)-[r:RECEIVED]->(w:Award {name: 'Nobel Prize in Physics'}) RETURN DISTINCT d.qid, d.name, r.year ORDER BY r.year LIMIT 100

Answer with ONLY the Cypher query inside a ```cypher code block."""

ANSWER_PROMPT = """You are answering a question about physicists using rows returned by a database query.
Write a short, direct answer (1-3 sentences, or a compact list if the question asks for one).
Use only the rows; if they are empty, say the graph has no record of it (Wikidata coverage is incomplete).
Do not mention Cypher, queries or databases."""

FORBIDDEN = re.compile(
    r"\b(CREATE|MERGE|SET|DELETE|DETACH|DROP|COPY|LOAD|INSTALL|ALTER|REMOVE|ATTACH|EXPORT|IMPORT|CALL|BEGIN|COMMIT|CHECKPOINT)\b",
    re.I,
)
LIMIT_RE = re.compile(r"\bLIMIT\s+(\d+)\s*;?\s*$", re.I)
QID_RE = re.compile(r"^Q\d+$")


class UnsafeQuery(ValueError):
    pass


def extract_cypher(text: str) -> str:
    m = re.search(r"```(?:cypher)?\s*(.+?)```", text, re.S | re.I)
    return (m.group(1) if m else text).strip().rstrip(";").strip()


def guard(cypher: str) -> str:
    """Reject writes and enforce a LIMIT. Pure function (unit-tested)."""
    stripped = re.sub(r"'[^']*'|\"[^\"]*\"", "''", cypher)  # ignore keywords inside strings
    if FORBIDDEN.search(stripped):
        raise UnsafeQuery("only read-only MATCH/RETURN queries are allowed")
    if ";" in stripped:
        raise UnsafeQuery("only a single statement is allowed")
    if not re.match(r"^\s*(MATCH|OPTIONAL\s+MATCH|WITH|UNWIND|RETURN)\b", stripped, re.I):
        raise UnsafeQuery("query must start with MATCH, WITH, UNWIND or RETURN")
    m = LIMIT_RE.search(cypher)
    if m:
        if int(m.group(1)) > MAX_LIMIT:
            cypher = cypher[: m.start()] + f"LIMIT {MAX_LIMIT}"
    else:
        cypher = f"{cypher} LIMIT {DEFAULT_LIMIT}"
    return cypher


@dataclass
class Result:
    question: str
    cypher: str = ""
    columns: list[str] = field(default_factory=list)
    rows: list[list] = field(default_factory=list)
    answer: str = ""
    attempts: int = 0
    error: str | None = None
    subgraph: dict = field(default_factory=lambda: {"nodes": [], "edges": []})


class GraphQA:
    def __init__(self, db_path: Path = DB_PATH, client: anthropic.Anthropic | None = None):
        self.db = kuzu.Database(str(db_path), read_only=True)
        self.conn = kuzu.Connection(self.db)
        self.conn.set_query_timeout(TIMEOUT_MS)
        self.client = client or anthropic.Anthropic()

    # -- LLM ------------------------------------------------------------------
    def _complete(self, system: str, messages: list[dict], max_tokens: int = 2000) -> str:
        kwargs = dict(
            model=MODEL,
            max_tokens=max_tokens,
            system=system,
            messages=messages,
            output_config={"effort": "medium"},
        )
        if USE_FALLBACKS and MODEL.startswith(
            ("claude-opus-5-5", "claude-fable", "claude-opus-5", "claude-sonnet-5-5")
        ):
            resp = self.client.beta.messages.create(
                betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kwargs
            )
        else:
            resp = self.client.messages.create(**kwargs)
        if resp.stop_reason == "refusal":
            raise RuntimeError("the model declined to answer this question")
        return "".join(b.text for b in resp.content if b.type == "text")

    def to_cypher(self, question: str, error_feedback: tuple[str, str] | None = None) -> str:
        msgs = [{"role": "user", "content": question}]
        if error_feedback:
            bad, err = error_feedback
            msgs += [
                {"role": "assistant", "content": f"```cypher\n{bad}\n```"},
                {
                    "role": "user",
                    "content": f"That query failed with:\n{err}\nReturn a corrected query.",
                },
            ]
        return extract_cypher(self._complete(SCHEMA_PROMPT, msgs))

    # -- DB -------------------------------------------------------------------
    def run(self, cypher: str) -> tuple[list[str], list[list]]:
        res = self.conn.execute(cypher)
        cols = res.get_column_names()
        rows = []
        while res.has_next():
            rows.append(res.get_next())
        return cols, rows

    def subgraph(self, rows: list[list]) -> dict:
        qids = sorted({v for r in rows for v in r if isinstance(v, str) and QID_RE.match(v)})[:300]
        edges = []
        if len(qids) > 1:
            _, er = self.run(
                "MATCH (a:Person)-[:ADVISED]->(b:Person) WHERE a.qid IN $q AND b.qid IN $q RETURN a.qid, b.qid LIMIT 2000".replace(
                    "$q", "[" + ",".join(f"'{q}'" for q in qids) + "]"
                )
            )
            edges = [[a, b] for a, b in er]
        return {"nodes": qids, "edges": edges}

    # -- pipeline -----------------------------------------------------------------
    def ask(self, question: str, answer: bool = True) -> Result:
        out = Result(question=question)
        feedback = None
        for attempt in (1, 2):
            out.attempts = attempt
            try:
                out.cypher = guard(self.to_cypher(question, feedback))
                out.columns, out.rows = self.run(out.cypher)
                out.error = None
                break
            except UnsafeQuery as exc:
                out.error = f"unsafe query rejected: {exc}"
                feedback = (out.cypher, str(exc))
            except RuntimeError as exc:  # kuzu errors are RuntimeError
                out.error = str(exc)
                feedback = (out.cypher, str(exc))
        if out.error:
            return out
        out.rows = [[_jsonable(v) for v in r] for r in out.rows]
        out.subgraph = self.subgraph(out.rows)
        if answer:
            preview = "\n".join(str(dict(zip(out.columns, r))) for r in out.rows[:60])
            out.answer = self._complete(
                ANSWER_PROMPT,
                [
                    {
                        "role": "user",
                        "content": f"Question: {question}\nRows ({len(out.rows)}):\n{preview or '(none)'}",
                    }
                ],
                max_tokens=1200,
            ).strip()
        return out


def _jsonable(v):
    if isinstance(v, (str, int, float, bool)) or v is None:
        return v
    if isinstance(v, dict):
        return {k: _jsonable(x) for k, x in v.items() if not k.startswith("_")}
    if isinstance(v, list):
        return [_jsonable(x) for x in v]
    return str(v)
