import { useMemo, useState } from "react";
import { ChartFrame } from "../components/ChartFrame";
import { Plot, PlotFigure } from "../components/PlotFigure";
import { Avatar, Button, ErrorState, LoadingBlock, PageHeader } from "../components/ui";
import { useJSON } from "../lib/data";
import { YEAR_MAX } from "../lib/filters";
import { fmtLife } from "../lib/format";
import { seriesColor } from "../lib/palette";
import { useApp } from "../lib/store";
import { FLAG } from "../lib/types";

interface Row {
  decade: number;
  institution: string;
  label: string;
  rank: number;
  centrality: number;
  headcount: number;
  country: string | null;
}
export interface InstData {
  decades: number[];
  rows: Row[];
  institutions: { institution: string; label: string; country: string | null; decades_in_top: number; best_rank: number }[];
  people_by_institution_decade: Record<string, Record<string, string[]>>;
}

export default function Institutions() {
  const { theme, filters, core, select } = useApp();
  const res = useJSON<InstData>("institutions.json");
  const [hover, setHover] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const dark = theme === "dark";
  const t = filters.year;

  const { rows, highlight } = useMemo(() => {
    if (!res.data) return { rows: [] as Row[], highlight: [] as string[] };
    const rows = res.data.rows.filter((r) => r.decade <= Math.max(t, 1860));
    // Persistent institutions (most decades in top 15) get the 6 validated hues; rest neutral.
    const highlight = [...res.data.institutions]
      .sort((a, b) => b.decades_in_top - a.decades_in_top || a.best_rank - b.best_rank)
      .slice(0, 6)
      .map((d) => d.institution);
    return { rows, highlight };
  }, [res.data, t]);

  if (res.error) return <ErrorState error={res.error} />;
  const focus = hover ?? picked;
  const colorOf = (id: string) => {
    const k = highlight.indexOf(id);
    return k >= 0 ? seriesColor(k, dark) : dark ? "#4a5466" : "#b9b09d";
  };
  const pickedInfo = picked && res.data ? res.data.institutions.find((d) => d.institution === picked) : null;
  const pickedPeople = picked && res.data ? (res.data.people_by_institution_decade[picked] ?? {}) : {};

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 md:px-8">
      <PageHeader kicker="Institutions over time" title="The centres of gravity">
        For each decade we connect institutions that shared people (employees or students active in that decade) and rank them by
        eigenvector centrality: an institution is central if it shares people with other central institutions. The chart shows the top 15
        per decade{t < YEAR_MAX && <>, up to the time slider ({t})</>}.
      </PageHeader>
      {!res.data ? (
        <LoadingBlock rows={10} />
      ) : (
        <div className="space-y-6">
          <ChartFrame
            title="Top 15 institutions by decade"
            rows={rows.map((r) => ({
              decade: r.decade,
              rank: r.rank,
              institution: r.label,
              country: r.country,
              centrality: +r.centrality.toFixed(4),
              people: r.headcount,
            }))}
            filename="institutions-bump"
            explain={
              <>
                Each line is an institution; lower is more central. Coloured lines are the six institutions that stay in the top 15 the
                longest; hover any line to trace it and click to list its people.
              </>
            }
          >
            <div data-testid="bump-chart">
              <PlotFigure
                height={520}
                deps={[rows, focus, dark]}
                make={(width) => ({
                  marginLeft: 30,
                  marginRight: width > 700 ? 170 : 20,
                  x: { label: "Decade", tickFormat: "d", grid: false },
                  y: { reverse: true, domain: [1, 15], ticks: 15, label: "Rank", grid: true },
                  color: { type: "identity" },
                  marks: [
                    Plot.line(rows, {
                      x: "decade",
                      y: "rank",
                      z: "institution",
                      stroke: (d: Row) => colorOf(d.institution),
                      strokeWidth: (d: Row) => (d.institution === focus ? 3.5 : highlight.includes(d.institution) ? 2 : 1),
                      strokeOpacity: (d: Row) =>
                        focus ? (d.institution === focus ? 1 : 0.12) : highlight.includes(d.institution) ? 0.95 : 0.35,
                      curve: "bump-x",
                    }),
                    Plot.dot(rows, {
                      x: "decade",
                      y: "rank",
                      fill: (d: Row) => colorOf(d.institution),
                      r: 3.5,
                      stroke: "var(--bg)",
                      strokeWidth: 1.5,
                      fillOpacity: (d: Row) => (focus && d.institution !== focus ? 0.12 : 1),
                    }),
                    width > 700
                      ? Plot.text(
                          rows.filter((d) => highlight.includes(d.institution) || d.institution === focus),
                          Plot.selectLast({
                            x: "decade",
                            y: "rank",
                            z: "institution",
                            text: (d: Row) =>
                              (d.label ?? d.institution).length > 24
                                ? (d.label ?? d.institution).slice(0, 23) + "…"
                                : (d.label ?? d.institution),
                            dx: 8,
                            textAnchor: "start",
                            fill: "var(--text)",
                            fillOpacity: (d: Row) => (focus && d.institution !== focus ? 0.25 : 1),
                          }),
                        )
                      : null,
                    Plot.tip(
                      rows,
                      Plot.pointer({
                        x: "decade",
                        y: "rank",
                        title: (d: Row) => `${d.label}\n${d.country ?? ""}\n${d.decade}s · rank ${d.rank}\n${d.headcount} people active`,
                      }),
                    ),
                  ],
                })}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Institutions">
              {res.data.institutions
                .slice()
                .sort((a, b) => b.decades_in_top - a.decades_in_top)
                .slice(0, 24)
                .map((d) => (
                  <button
                    key={d.institution}
                    type="button"
                    onMouseEnter={() => setHover(d.institution)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(d.institution)}
                    onBlur={() => setHover(null)}
                    onClick={() => setPicked(picked === d.institution ? null : d.institution)}
                    aria-pressed={picked === d.institution}
                    className={
                      "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs " +
                      (picked === d.institution ? "border-text" : "border-line text-muted hover:text-text")
                    }
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: colorOf(d.institution) }} />
                    {d.label}
                  </button>
                ))}
            </div>
          </ChartFrame>
          {pickedInfo && core && (
            <section className="rounded-xl border border-line bg-surface/60 p-5" aria-live="polite">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xl">
                  {pickedInfo.label} <span className="text-sm text-muted">{pickedInfo.country}</span>
                </h2>
                <Button onClick={() => setPicked(null)}>Close</Button>
              </div>
              <p className="mb-3 text-sm text-muted">
                In the top 15 for {pickedInfo.decades_in_top} decades; best rank {pickedInfo.best_rank}. People active there, by decade:
              </p>
              <div className="space-y-3">
                {Object.entries(pickedPeople)
                  .sort((a, b) => Number(a[0]) - Number(b[0]))
                  .map(([dec, qids]) => (
                    <div key={dec} className="grid grid-cols-[60px_1fr] gap-3">
                      <div className="font-display text-lg text-muted">{dec}s</div>
                      <div className="flex flex-wrap gap-1.5">
                        {qids.map((q) => {
                          const i = core.index.get(q);
                          if (i === undefined) return null;
                          return (
                            <button
                              key={q}
                              type="button"
                              onClick={() => select(i)}
                              className={
                                "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs hover:bg-surface-2 " +
                                (core.people.f[i] & FLAG.laureate ? "border-gold/50 text-gold" : "border-line")
                              }
                              title={fmtLife(core.people.by[i], core.people.dy[i])}
                            >
                              <Avatar name={core.people.name[i]} img={core.people.img[i] || undefined} size={18} />
                              {core.people.name[i]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
