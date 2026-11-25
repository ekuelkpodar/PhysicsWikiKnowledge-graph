"""Writes api/eval_questions.json (30 questions, DuckDB ground truth + gold Cypher)."""

import json
from pathlib import Path

P = "nodes_person"


def awardees(label):
    return f"SELECT DISTINCT e.person FROM edges_award e JOIN nodes_award a ON a.qid=e.award JOIN {P} p ON p.qid=e.person WHERE a.label='{label}'"


def students(name):
    return f"SELECT s.qid FROM edges_advised e JOIN {P} a ON a.qid=e.advisor JOIN {P} s ON s.qid=e.student WHERE a.name='{name}'"


Q = [
    (
        "Who were Niels Bohr's doctoral students?",
        "set",
        students("Niels Bohr"),
        "MATCH (a:Person {name:'Niels Bohr'})-[:ADVISED]->(s:Person) RETURN s.qid, s.name",
    ),
    (
        "Who was Max Born's doctoral advisor?",
        "set",
        f"SELECT a.qid FROM edges_advised e JOIN {P} a ON a.qid=e.advisor JOIN {P} s ON s.qid=e.student WHERE s.name='Max Born'",
        "MATCH (a:Person)-[:ADVISED]->(s:Person {name:'Max Born'}) RETURN a.qid, a.name",
    ),
    (
        "Which doctoral students of Arnold Sommerfeld won the Nobel Prize in Physics?",
        "set",
        f"{students('Arnold Sommerfeld')} AND s.qid IN ({awardees('Nobel Prize in Physics')})",
        "MATCH (a:Person {name:'Arnold Sommerfeld'})-[:ADVISED]->(s:Person)-[:RECEIVED]->(w:Award {name:'Nobel Prize in Physics'}) RETURN DISTINCT s.qid, s.name",
    ),
    (
        "How many doctoral students did Arnold Sommerfeld have?",
        "scalar",
        f"SELECT count(*) FROM ({students('Arnold Sommerfeld')})",
        "MATCH (a:Person {name:'Arnold Sommerfeld'})-[:ADVISED]->(s:Person) RETURN count(DISTINCT s)",
    ),
    (
        "Which Nobel Prize in Physics laureates had a Nobel laureate (any Nobel) as doctoral advisor?",
        "set",
        f"SELECT DISTINCT s.qid FROM edges_advised e JOIN {P} a ON a.qid=e.advisor JOIN {P} s ON s.qid=e.student WHERE a.is_nobel AND s.qid IN ({awardees('Nobel Prize in Physics')})",
        "MATCH (a:Person)-[:ADVISED]->(s:Person)-[:RECEIVED]->(w:Award {name:'Nobel Prize in Physics'}) WHERE a.is_nobel RETURN DISTINCT s.qid, s.name",
    ),
    (
        "Who received the Nobel Prize in Physics in 1921?",
        "set",
        f"SELECT e.person FROM edges_award e JOIN nodes_award a ON a.qid=e.award JOIN {P} p ON p.qid=e.person WHERE a.label='Nobel Prize in Physics' AND e.year=1921",
        "MATCH (p:Person)-[r:RECEIVED]->(w:Award {name:'Nobel Prize in Physics'}) WHERE r.year = 1921 RETURN p.qid, p.name",
    ),
    (
        "How many people in the graph received the Nobel Prize in Physics?",
        "scalar",
        f"SELECT count(*) FROM ({awardees('Nobel Prize in Physics')})",
        "MATCH (p:Person)-[:RECEIVED]->(w:Award {name:'Nobel Prize in Physics'}) RETURN count(DISTINCT p)",
    ),
    (
        "Which women received the Nobel Prize in Physics?",
        "set",
        f"SELECT qid FROM {P} WHERE gender='female' AND qid IN ({awardees('Nobel Prize in Physics')})",
        "MATCH (p:Person)-[:RECEIVED]->(w:Award {name:'Nobel Prize in Physics'}) WHERE p.gender = 'female' RETURN DISTINCT p.qid, p.name",
    ),
    (
        "Which physicists born in Hungary worked at an institution in the United States?",
        "set",
        f"SELECT DISTINCT p.qid FROM {P} p JOIN edges_employer e ON e.person=p.qid JOIN nodes_institution i ON i.qid=e.institution WHERE p.birth_country='Hungary' AND i.country='United States'",
        "MATCH (p:Person)-[:WORKED_AT]->(i:Institution) WHERE p.birth_country = 'Hungary' AND i.country = 'United States' RETURN DISTINCT p.qid, p.name",
    ),
    (
        "How many people worked at CERN?",
        "scalar",
        f"SELECT count(DISTINCT e.person) FROM edges_employer e JOIN nodes_institution i ON i.qid=e.institution JOIN {P} p ON p.qid=e.person WHERE i.label='CERN'",
        "MATCH (p:Person)-[:WORKED_AT]->(i:Institution {name:'CERN'}) RETURN count(DISTINCT p)",
    ),
    (
        "Who were J. J. Thomson's doctoral students?",
        "set",
        students("Joseph John Thomson"),
        "MATCH (a:Person {name:'Joseph John Thomson'})-[:ADVISED]->(s:Person) RETURN s.qid, s.name",
    ),
    (
        "Who was Richard Feynman's doctoral advisor?",
        "set",
        f"SELECT a.qid FROM edges_advised e JOIN {P} a ON a.qid=e.advisor JOIN {P} s ON s.qid=e.student WHERE s.name='Richard Feynman'",
        "MATCH (a:Person)-[:ADVISED]->(s:Person {name:'Richard Feynman'}) RETURN a.qid, a.name",
    ),
    (
        "Who in the graph received the Fields Medal?",
        "set",
        awardees("Fields medal"),
        "MATCH (p:Person)-[:RECEIVED]->(w:Award {name:'Fields medal'}) RETURN DISTINCT p.qid, p.name",
    ),
    (
        "Who are Niels Bohr's academic grandchildren (students of his students)?",
        "set",
        f"SELECT DISTINCT e2.student FROM edges_advised e1 JOIN {P} a ON a.qid=e1.advisor JOIN edges_advised e2 ON e2.advisor=e1.student JOIN {P} g ON g.qid=e2.student JOIN {P} m ON m.qid=e1.student WHERE a.name='Niels Bohr'",
        "MATCH (a:Person {name:'Niels Bohr'})-[:ADVISED]->(:Person)-[:ADVISED]->(g:Person) RETURN DISTINCT g.qid, g.name",
    ),
    (
        "Which doctoral students of Enrico Fermi won a Nobel Prize?",
        "set",
        f"{students('Enrico Fermi')} AND s.is_nobel",
        "MATCH (a:Person {name:'Enrico Fermi'})-[:ADVISED]->(s:Person) WHERE s.is_nobel RETURN s.qid, s.name",
    ),
    (
        "Who received both the Nobel Prize in Physics and the Copley Medal?",
        "set",
        f"{awardees('Nobel Prize in Physics')} INTERSECT {awardees('Copley Medal')}",
        "MATCH (w1:Award {name:'Nobel Prize in Physics'})<-[:RECEIVED]-(p:Person)-[:RECEIVED]->(w2:Award {name:'Copley Medal'}) RETURN DISTINCT p.qid, p.name",
    ),
    (
        "How many people in the graph were born before 1700?",
        "scalar",
        f"SELECT count(*) FROM {P} WHERE birth_year < 1700",
        "MATCH (p:Person) WHERE p.birth_year < 1700 RETURN count(p)",
    ),
    (
        "Who received the Wolf Prize in Physics in the 1990s?",
        "set",
        f"SELECT DISTINCT e.person FROM edges_award e JOIN nodes_award a ON a.qid=e.award JOIN {P} p ON p.qid=e.person WHERE a.label='Wolf Prize in Physics' AND e.year BETWEEN 1990 AND 1999",
        "MATCH (p:Person)-[r:RECEIVED]->(w:Award {name:'Wolf Prize in Physics'}) WHERE r.year >= 1990 AND r.year <= 1999 RETURN DISTINCT p.qid, p.name",
    ),
    (
        "Who received both the ICTP Dirac Medal and the Nobel Prize in Physics?",
        "set",
        f"{awardees('ICTP Dirac Medal')} INTERSECT {awardees('Nobel Prize in Physics')}",
        "MATCH (w1:Award {name:'ICTP Dirac Medal'})<-[:RECEIVED]-(p:Person)-[:RECEIVED]->(w2:Award {name:'Nobel Prize in Physics'}) RETURN DISTINCT p.qid, p.name",
    ),
    (
        "Who was Marie Curie's doctoral advisor?",
        "set",
        f"SELECT a.qid FROM edges_advised e JOIN {P} a ON a.qid=e.advisor JOIN {P} s ON s.qid=e.student WHERE s.name='Marie Sklodowska-Curie'",
        "MATCH (a:Person)-[:ADVISED]->(s:Person {name:'Marie Sklodowska-Curie'}) RETURN a.qid, a.name",
    ),
    (
        "Which of Ernest Rutherford's doctoral students won the Nobel Prize in Physics?",
        "set",
        f"{students('Ernest Rutherford')} AND s.qid IN ({awardees('Nobel Prize in Physics')})",
        "MATCH (a:Person {name:'Ernest Rutherford'})-[:ADVISED]->(s:Person)-[:RECEIVED]->(:Award {name:'Nobel Prize in Physics'}) RETURN DISTINCT s.qid, s.name",
    ),
    (
        "How many doctoral students did Max Born have?",
        "scalar",
        f"SELECT count(*) FROM ({students('Max Born')})",
        "MATCH (a:Person {name:'Max Born'})-[:ADVISED]->(s:Person) RETURN count(DISTINCT s)",
    ),
    (
        "Who was educated at the University of Cambridge and won the Nobel Prize in Physics?",
        "set",
        f"SELECT DISTINCT e.person FROM edges_educated e JOIN nodes_institution i ON i.qid=e.institution JOIN {P} p ON p.qid=e.person WHERE i.label='University of Cambridge' AND e.person IN ({awardees('Nobel Prize in Physics')})",
        "MATCH (i:Institution {name:'University of Cambridge'})<-[:EDUCATED_AT]-(p:Person)-[:RECEIVED]->(:Award {name:'Nobel Prize in Physics'}) RETURN DISTINCT p.qid, p.name",
    ),
    (
        "Who worked at the Institute for Advanced Study?",
        "set",
        f"SELECT DISTINCT e.person FROM edges_employer e JOIN nodes_institution i ON i.qid=e.institution JOIN {P} p ON p.qid=e.person WHERE i.label='Institute for Advanced Study'",
        "MATCH (p:Person)-[:WORKED_AT]->(i:Institution {name:'Institute for Advanced Study'}) RETURN DISTINCT p.qid, p.name",
    ),
    (
        "Which people working in quantum mechanics were born in Austria?",
        "set",
        f"SELECT DISTINCT p.qid FROM {P} p JOIN edges_field e ON e.person=p.qid JOIN nodes_field f ON f.qid=e.field WHERE f.label='quantum mechanics' AND p.birth_country='Austria'",
        "MATCH (p:Person)-[:WORKS_IN]->(f:Field {name:'quantum mechanics'}) WHERE p.birth_country = 'Austria' RETURN DISTINCT p.qid, p.name",
    ),
    (
        "Who shared a doctoral advisor with Werner Heisenberg?",
        "set",
        f"SELECT DISTINCT e2.student FROM edges_advised e1 JOIN {P} h ON h.qid=e1.student JOIN edges_advised e2 ON e2.advisor=e1.advisor JOIN {P} s ON s.qid=e2.student JOIN {P} a ON a.qid=e1.advisor WHERE h.name='Werner Heisenberg' AND s.name<>'Werner Heisenberg'",
        "MATCH (h:Person {name:'Werner Heisenberg'})<-[:ADVISED]-(a:Person)-[:ADVISED]->(s:Person) WHERE s.qid <> h.qid RETURN DISTINCT s.qid, s.name",
    ),
    (
        "How many academic descendants does Arnold Sommerfeld have within three generations?",
        "scalar",
        f"WITH RECURSIVE d(q, depth) AS (SELECT e.student, 1 FROM edges_advised e JOIN {P} a ON a.qid=e.advisor WHERE a.name='Arnold Sommerfeld' UNION SELECT e.student, d.depth+1 FROM edges_advised e JOIN d ON e.advisor=d.q WHERE d.depth < 3) SELECT count(DISTINCT q) FROM d WHERE q IN (SELECT qid FROM {P})",
        "MATCH (a:Person {name:'Arnold Sommerfeld'})-[:ADVISED*1..3]->(d:Person) RETURN count(DISTINCT d)",
    ),
    (
        "Who is the earliest-born recipient of the Nobel Prize in Physics in the graph?",
        "set",
        f"SELECT qid FROM {P} WHERE qid IN ({awardees('Nobel Prize in Physics')}) AND birth_year = (SELECT min(birth_year) FROM {P} WHERE qid IN ({awardees('Nobel Prize in Physics')}))",
        "MATCH (p:Person)-[:RECEIVED]->(:Award {name:'Nobel Prize in Physics'}) WITH min(p.birth_year) AS y MATCH (q:Person)-[:RECEIVED]->(:Award {name:'Nobel Prize in Physics'}) WHERE q.birth_year = y RETURN DISTINCT q.qid, q.name",
    ),
    (
        "How many people received the Max Planck Medal?",
        "scalar",
        f"SELECT count(*) FROM ({awardees('Max Planck Medal')})",
        "MATCH (p:Person)-[:RECEIVED]->(:Award {name:'Max Planck Medal'}) RETURN count(DISTINCT p)",
    ),
    (
        "Which laureates of a major award were born in Japan?",
        "set",
        f"SELECT qid FROM {P} WHERE is_laureate AND birth_country='Japan'",
        "MATCH (p:Person) WHERE p.is_laureate AND p.birth_country = 'Japan' RETURN p.qid, p.name",
    ),
]

items = [
    {"id": i + 1, "question": q, "kind": k, "sql": s, "gold_cypher": c}
    for i, (q, k, s, c) in enumerate(Q)
]
Path(__file__).with_name("eval_questions.json").write_text(
    json.dumps(items, indent=1, ensure_ascii=False)
)
print(len(items), "questions")
