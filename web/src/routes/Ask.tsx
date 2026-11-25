import Graph from "graphology";
import { useEffect, useRef, useState } from "react";
import Sigma from "sigma";
import { Button, EmptyState, PageHeader } from "../components/ui";
import { API_URL, useApp, type Core } from "../lib/store";
import { FLAG } from "../lib/types";

interface Answer {
  question: string;
  answer: string;
  cypher: string;
  columns: string[];
  rows: unknown[][];
  subgraph: { nodes: string[]; edges: [string, string][] };
  error?: string;
  attempts?: number;
}

const SUGGESTED = [
  "Who were Niels Bohr's doctoral students?",
  "Which Nobel laureates in physics had a Nobel laureate as their doctoral advisor?",
  "How many academic generations separate Arnold Sommerfeld from his furthest descendant?",
  "Which institutions employed the most laureates?",
  "Who were the doctoral students of Max Born who won a Nobel Prize?",
  "Which physicists born in Hungary worked in the United States?",
];

export default function Ask() {
  const { apiUp, core } = useApp();
  const [q, setQ] = useState("");
  const [log, setLog] = useState<Answer[]>([]);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [log.length]);

  const api = API_URL;
  if (!apiUp || !api)
    return (
      <EmptyState title="“Ask the graph” needs the local API">
        This view talks to a small FastAPI service that translates questions into Cypher. Run <code>make api</code> with an{" "}
        <code>ANTHROPIC_API_KEY</code>, then build the site with <code>VITE_ASK_API=http://localhost:8000</code>. Everything else works
        without it.
      </EmptyState>
    );

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    setBusy(true);
    setQ("");
    try {
      const r = await fetch(`${api.replace(/\/$/, "")}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await r.json();
      setLog((l) => [
        ...l,
        r.ok
          ? { ...data, question }
          : {
              question,
              answer: "",
              cypher: "",
              columns: [],
              rows: [],
              subgraph: { nodes: [], edges: [] },
              error: data.detail ?? "Request failed",
            },
      ]);
    } catch (e) {
      setLog((l) => [
        ...l,
        { question, answer: "", cypher: "", columns: [], rows: [], subgraph: { nodes: [], edges: [] }, error: String(e) },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col px-4 py-6">
      <PageHeader kicker="GraphRAG" title="Ask the graph">
        Questions are translated into a read-only Cypher query over the knowledge graph. You see the query, the raw rows, and the people
        involved.
      </PageHeader>
      <div className="flex-1 space-y-6" aria-live="polite">
        {log.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTED.map((s) => (
              <Button key={s} variant="outline" onClick={() => ask(s)} className="text-left">
                {s}
              </Button>
            ))}
          </div>
        )}
        {log.map((a, k) => (
          <article key={k} className="space-y-3">
            <p className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-sm bg-surface-2 px-4 py-2">{a.question}</p>
            {a.error ? (
              <p className="text-danger">Sorry: {a.error}</p>
            ) : (
              <div className="space-y-3 rounded-xl border border-line p-4">
                <p className="leading-relaxed">{a.answer}</p>
                <details>
                  <summary className="cursor-pointer text-xs text-muted">
                    Cypher{a.attempts && a.attempts > 1 ? ` (fixed after ${a.attempts - 1} retry)` : ""}
                  </summary>
                  <pre className="mt-2 overflow-x-auto rounded bg-bg p-3 text-xs">{a.cypher}</pre>
                </details>
                {a.rows.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-xs text-muted">{a.rows.length} result rows</summary>
                    <div className="mt-2 max-h-64 overflow-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr>
                            {a.columns.map((c) => (
                              <th key={c} className="px-2 py-1 text-muted">
                                {c}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {a.rows.slice(0, 100).map((r, i) => (
                            <tr key={i} className="border-t border-line">
                              {r.map((v, j) => (
                                <td key={j} className="px-2 py-1">
                                  {typeof v === "object" ? JSON.stringify(v) : String(v)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
                {core && a.subgraph.nodes.length > 0 && <MiniGraph core={core} sub={a.subgraph} />}
              </div>
            )}
          </article>
        ))}
        {busy && <p className="text-sm text-muted">Thinking…</p>}
        <div ref={endRef} />
      </div>
      <form
        className="sticky bottom-0 mt-4 flex gap-2 bg-bg py-3"
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask about advisors, awards, institutions…"
          aria-label="Question"
          className="flex-1 rounded-lg border border-line bg-surface px-4 py-2"
        />
        <Button variant="solid" type="submit" disabled={busy || !q.trim()}>
          Ask
        </Button>
      </form>
    </div>
  );
}

function MiniGraph({ core, sub }: { core: Core; sub: Answer["subgraph"] }) {
  const ref = useRef<HTMLDivElement>(null);
  const { theme, select } = useApp();
  useEffect(() => {
    if (!ref.current) return;
    const g = new Graph();
    const ids = sub.nodes
      .map((q) => core.index.get(q))
      .filter((i): i is number => i !== undefined)
      .slice(0, 300);
    const set = new Set(ids);
    const dark = theme === "dark";
    ids.forEach((i, k) => {
      const a = (2 * Math.PI * k) / ids.length;
      g.addNode(String(i), {
        x: core.layout.x[i] ?? Math.cos(a),
        y: core.layout.y[i] ?? Math.sin(a),
        size: 4 + Math.min(8, Math.sqrt(core.people.d[i]) * 0.4),
        label: core.people.name[i],
        color: core.people.f[i] & FLAG.laureate ? (dark ? "#e0b55a" : "#a8770f") : dark ? "#8b94a8" : "#4a5468",
      });
    });
    ids.forEach((i) =>
      core.adj.students[i].forEach(
        (s) =>
          set.has(s) &&
          !g.hasEdge(String(i), String(s)) &&
          g.addEdge(String(i), String(s), { size: 1.2, color: dark ? "#ebe2cc55" : "#1b213055" }),
      ),
    );
    const s = new Sigma(g, ref.current, {
      renderLabels: true,
      labelColor: { color: dark ? "#ebe2cc" : "#1b2130" },
      labelRenderedSizeThreshold: 0,
    });
    s.on("clickNode", ({ node }) => select(Number(node)));
    return () => s.kill();
  }, [core, sub, theme, select]);
  return <div ref={ref} className="h-64 rounded-lg border border-line" aria-label="People in this answer" role="img" />;
}
