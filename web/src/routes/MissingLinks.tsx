import { useMemo, useState } from "react";
import { Button, Chip, EmptyState, ErrorState, IconExternal, LoadingBlock, PageHeader, Stat } from "../components/ui";
import { useJSON } from "../lib/data";
import { downloadCSV } from "../lib/export";
import { fmtPct } from "../lib/format";
import { useApp } from "../lib/store";

interface Pred {
  advisor: number;
  advisor_name: string;
  advisor_qid: string;
  student: number;
  student_name: string;
  student_qid: string;
  score: number;
  corroborated_p1066: boolean;
  shared_institutions: { label: string; from: number; to: number }[];
  shared_fields: string[];
  age_gap: number | null;
}
export interface LinksData {
  metrics: Record<string, Record<string, number>>;
  best_model: string;
  split: { train: number; test: number };
  top_corroborated_by_p1066: number;
  p1066_external_check: { students_evaluable: number; "hit@1_rate": number; "hit@3_rate": number; mean_candidates_per_student: number };
  n_candidates: number;
  predictions: Pred[];
}

const MODEL_NAME: Record<string, string> = { features_lr: "Features only", node2vec_lr: "node2vec + LR", graphsage: "GraphSAGE" };

export default function MissingLinks() {
  const { select, core } = useApp();
  const res = useJSON<LinksData>("links.json");
  const [view, setView] = useState<"cards" | "table">("cards");
  const [onlyCorr, setOnlyCorr] = useState(false);
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    if (!res.data) return [];
    const ql = q.toLowerCase();
    return res.data.predictions.filter(
      (p) =>
        (!onlyCorr || p.corroborated_p1066) &&
        (!ql || p.advisor_name.toLowerCase().includes(ql) || p.student_name.toLowerCase().includes(ql)),
    );
  }, [res.data, onlyCorr, q]);

  if (res.error) return <ErrorState error={res.error} />;
  if (!res.data || !core)
    return (
      <div className="p-8">
        <LoadingBlock rows={10} />
      </div>
    );
  const d = res.data;
  const best = d.metrics[d.best_model];
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 md:px-8">
      <PageHeader kicker="Link prediction" title="Missing advisor links">
        A model trained on {d.split.train.toLocaleString()} known advisor→student links suggests advisors for people who have none recorded.
        Each suggestion comes with its evidence: a shared institution in an overlapping period, shared fields, and a plausible age gap.
        These are <b className="text-text">leads for Wikidata editors, not facts.</b>
      </PageHeader>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={`AUC · ${MODEL_NAME[d.best_model] ?? d.best_model}`}
          value={best.auc.toFixed(3)}
          hint={`${d.split.test.toLocaleString()} held-out links vs matched negatives`}
        />
        <Stat label="Average precision" value={best.ap.toFixed(3)} />
        <Stat
          label="Hits@10 vs plausible"
          value={fmtPct(best["hits@10_vs_plausible"])}
          hint="True advisor ranked top-10 among colleagues 15–45 years older"
          tone="cyan"
        />
        <Stat
          label="Independent check"
          value={fmtPct(d.p1066_external_check["hit@1_rate"])}
          hint={`For ${d.p1066_external_check.students_evaluable} students with a 'student of' (P1066) teacher, which the model never saw, that teacher is ranked #1 (chance ≈ ${fmtPct(1 / d.p1066_external_check.mean_candidates_per_student)})`}
          tone="gold"
        />
      </div>
      <details className="mb-6 rounded-xl border border-line p-4 text-sm">
        <summary className="cursor-pointer font-display text-lg">Model comparison</summary>
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-1">Model</th>
              <th>AUC</th>
              <th>AP</th>
              <th>AUC (hard negatives)</th>
              <th>Hits@10 (100 random)</th>
              <th>Hits@10 (plausible)</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(d.metrics).map(([k, m]) => (
              <tr key={k} className={"border-t border-line " + (k === d.best_model ? "text-gold" : "")}>
                <td className="py-1">{MODEL_NAME[k] ?? k}</td>
                <td className="tabular-nums">{m.auc.toFixed(3)}</td>
                <td className="tabular-nums">{m.ap.toFixed(3)}</td>
                <td className="tabular-nums">{m.auc_hard_negatives_only.toFixed(3)}</td>
                <td className="tabular-nums">{fmtPct(m["hits@10_vs_100_random"], 1)}</td>
                <td className="tabular-nums">{fmtPct(m["hits@10_vs_plausible"], 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by name…"
          aria-label="Filter predictions by name"
          className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm"
        />
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={onlyCorr} onChange={(e) => setOnlyCorr(e.target.checked)} className="accent-[var(--gold)]" />{" "}
          Corroborated only
        </label>
        <div className="ml-auto flex gap-1">
          <Button variant={view === "cards" ? "solid" : "outline"} onClick={() => setView("cards")} aria-pressed={view === "cards"}>
            Cards
          </Button>
          <Button variant={view === "table" ? "solid" : "outline"} onClick={() => setView("table")} aria-pressed={view === "table"}>
            Table
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              downloadCSV(
                "predicted-advisors.csv",
                rows.map((r) => ({
                  advisor: r.advisor_name,
                  advisor_qid: r.advisor_qid,
                  student: r.student_name,
                  student_qid: r.student_qid,
                  score: r.score.toFixed(3),
                  shared_institutions: r.shared_institutions.map((s) => `${s.label} ${s.from}-${s.to}`),
                  shared_fields: r.shared_fields,
                  age_gap: r.age_gap,
                  corroborated_p1066: r.corroborated_p1066,
                })),
              )
            }
          >
            CSV
          </Button>
        </div>
      </div>
      {rows.length === 0 && <EmptyState title="No predictions match">Clear the name filter or untick “corroborated only”.</EmptyState>}
      {view === "cards" ? (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="predictions">
          {rows.map((r) => (
            <li key={`${r.advisor}-${r.student}`} className="rounded-xl border border-dashed border-cyan/50 bg-surface/50 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm">
                  <button type="button" className="font-display text-lg hover:underline" onClick={() => select(r.student)}>
                    {r.student_name}
                  </button>
                  <div className="text-muted">
                    probably advised by{" "}
                    <button type="button" className="text-cyan hover:underline" onClick={() => select(r.advisor)}>
                      {r.advisor_name}
                    </button>
                  </div>
                </div>
                <RankBadge rank={d.predictions.indexOf(r) + 1} score={r.score} />
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {r.shared_institutions.map((s) => (
                  <Chip key={s.label} tone="cyan">
                    {s.label} {s.from}–{s.to}
                  </Chip>
                ))}
                {r.shared_fields.map((f) => (
                  <Chip key={f}>{f}</Chip>
                ))}
                {r.age_gap !== null && <Chip>{r.age_gap}y older</Chip>}
                {r.corroborated_p1066 && <Chip tone="gold">already “student of”</Chip>}
              </div>
              <div className="mt-3 flex gap-3 text-xs">
                <a
                  className="inline-flex items-center gap-1 text-cyan hover:underline"
                  href={`https://www.wikidata.org/wiki/${r.student_qid}#P184`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open student on Wikidata <IconExternal className="h-3 w-3" />
                </a>
                <a
                  className="inline-flex items-center gap-1 text-muted hover:underline"
                  href={`https://www.wikidata.org/wiki/${r.advisor_qid}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  advisor <IconExternal className="h-3 w-3" />
                </a>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface text-xs text-muted">
              <tr>
                <th className="px-3 py-2">Student</th>
                <th>Predicted advisor</th>
                <th>Score</th>
                <th>Evidence</th>
                <th>Wikidata</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.advisor}-${r.student}`} className="border-t border-line">
                  <td className="px-3 py-1.5">
                    <button type="button" className="hover:underline" onClick={() => select(r.student)}>
                      {r.student_name}
                    </button>
                  </td>
                  <td>
                    <button type="button" className="text-cyan hover:underline" onClick={() => select(r.advisor)}>
                      {r.advisor_name}
                    </button>
                  </td>
                  <td className="tabular-nums">{r.score.toFixed(3)}</td>
                  <td className="text-xs text-muted">
                    {[
                      ...r.shared_institutions.map((s) => s.label),
                      ...r.shared_fields,
                      r.age_gap !== null ? `${r.age_gap}y gap` : null,
                      r.corroborated_p1066 ? "P1066 ✓" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </td>
                  <td>
                    <a
                      className="text-cyan hover:underline"
                      href={`https://www.wikidata.org/wiki/${r.student_qid}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {r.student_qid}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RankBadge({ rank, score }: { rank: number; score: number }) {
  // Probabilities saturate near 1 for the strongest candidates, so we show the rank.
  return (
    <span
      className="flex h-10 min-w-10 shrink-0 items-center justify-center rounded-full border border-cyan/60 px-2 font-display text-sm text-cyan tabular-nums"
      title={`Model score ${score.toFixed(4)}`}
      aria-label={`Rank ${rank}, score ${score.toFixed(3)}`}
    >
      #{rank}
    </span>
  );
}
