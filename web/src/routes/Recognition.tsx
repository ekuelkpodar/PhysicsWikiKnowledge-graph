import { useMemo, useState } from "react";
import { ChartFrame } from "../components/ChartFrame";
import { Plot, PlotFigure } from "../components/PlotFigure";
import { Button, ErrorState, LoadingBlock, PageHeader, Stat } from "../components/ui";
import { useJSON } from "../lib/data";
import { fmtPct } from "../lib/format";
import { seriesColor } from "../lib/palette";
import { useApp } from "../lib/store";

interface Curve {
  group: string;
  n: number;
  events: number;
  t: number[];
  cum: number[];
  lo: number[];
  hi: number[];
}
export interface SurvivalData {
  population: { n: number; events: number; censored: number; excluded_missing_death: number; cohorts: [number, number]; clock: string };
  cox: {
    c_index_test: number;
    c_index_train: number;
    hazard_ratios: { covariate: string; hr: number; lo: number; hi: number; p: number }[];
    "ph_assumption_violations_p<0.01": string[];
  };
  rsf: { c_index_test?: number; error?: string };
  km: Record<string, { by: string; curves: Curve[]; logrank_p?: number }>;
  event_rates: Record<string, Record<string, number>>;
}

const GROUPS: [string, string][] = [
  ["laureate_advisor", "Laureate advisor"],
  ["has_recorded_advisor", "Advisor recorded"],
  ["top_institution", "Top institution"],
  ["cohort", "Birth cohort"],
  ["country", "Country"],
  ["gender", "Gender"],
];

const NICE: Record<string, string> = {
  laureate_advisor: "Advisor is a laureate",
  advisor_pagerank_pct: "Advisor PageRank (percentile)",
  has_recorded_advisor: "Has an advisor on Wikidata",
  top_institution: "Worked at a top-25 institution",
  female: "Female",
};
const nice = (k: string) =>
  NICE[k] ??
  k
    .replace(/^country_/, "Born in ")
    .replace(/^cohort_/, "Born ")
    .replace(/^field_/, "Field: ");

export default function Recognition() {
  const { theme } = useApp();
  const res = useJSON<SurvivalData>("survival.json");
  const [group, setGroup] = useState("laureate_advisor");
  const dark = theme === "dark";
  const km = res.data?.km[group];
  const flat = useMemo(
    () =>
      km
        ? km.curves.flatMap((c) =>
            c.t.map((t, k) => ({ group: `${c.group} (n=${c.n.toLocaleString()})`, t, cum: c.cum[k], lo: c.lo[k], hi: c.hi[k] })),
          )
        : [],
    [km],
  );
  const hr = useMemo(() => (res.data ? [...res.data.cox.hazard_ratios].sort((a, b) => b.hr - a.hr) : []), [res.data]);

  if (res.error) return <ErrorState error={res.error} />;
  if (!res.data || !km)
    return (
      <div className="p-8">
        <LoadingBlock rows={10} />
      </div>
    );
  const d = res.data;
  const groups = km.curves.map((c) => `${c.group} (n=${c.n.toLocaleString()})`);
  const colors = groups.map((_, i) => seriesColor(i, dark));
  const top = hr.find((h) => h.covariate === "laureate_advisor");

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 md:px-8">
      <PageHeader kicker="Recognition · survival analysis" title="Who gets recognised, and how fast?">
        We follow {d.population.n.toLocaleString()} core physicists born {d.population.cohorts[0]}–{d.population.cohorts[1]} from age 27 (a
        proxy for finishing a PhD) until their first major award. People without an award are <em>censored</em> at death or today, not
        counted as failures. {d.population.excluded_missing_death} people born before 1910 with no death date are excluded rather than
        treated as alive.
      </PageHeader>
      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <Stat label="People followed" value={d.population.n.toLocaleString()} />
        <Stat label="Won a major award" value={d.population.events.toLocaleString()} tone="gold" />
        <Stat label="Cox C-index (held out)" value={d.cox.c_index_test.toFixed(3)} hint="0.5 = coin flip, 1 = perfect ordering" />
        <Stat
          label="Random survival forest"
          value={d.rsf.c_index_test ? d.rsf.c_index_test.toFixed(3) : "n/a"}
          hint="C-index, same held-out 25%"
        />
      </div>
      <div className="space-y-6">
        <ChartFrame
          title="Share with a major award, by years since age 27"
          rows={flat.map((r) => ({ group: r.group, years_since_27: r.t, share_awarded: r.cum, ci_low: r.lo, ci_high: r.hi }))}
          filename={`km-${group}`}
          explain={
            <>
              Each line is a Kaplan–Meier estimate: the share of the group who had won a major award by each year after age 27, with a 95%
              band. A line that rises faster means recognition comes sooner and more often.
              {km.logrank_p !== undefined && (
                <>
                  {" "}
                  The difference between the two groups is{" "}
                  {km.logrank_p < 0.001 ? "highly significant (log-rank p < 0.001)" : `log-rank p = ${km.logrank_p.toFixed(3)}`}.
                </>
              )}{" "}
              {group === "laureate_advisor" &&
                "Careful: having any advisor recorded on Wikidata is itself a marker of fame. Compare with the 'Advisor recorded' toggle."}
            </>
          }
        >
          <div className="mb-3 flex flex-wrap gap-1" role="group" aria-label="Group by">
            {GROUPS.map(([k, l]) => (
              <Button
                key={k}
                variant={group === k ? "solid" : "outline"}
                onClick={() => setGroup(k)}
                aria-pressed={group === k}
                className="text-xs"
              >
                {l}
              </Button>
            ))}
          </div>
          <div data-testid="km-chart">
            <PlotFigure
              height={380}
              deps={[flat, dark]}
              make={() => ({
                marginLeft: 48,
                x: { label: "Years since age 27 →", domain: [0, 60] },
                y: { label: "↑ Share with a major award", tickFormat: "%", grid: true },
                color: { domain: groups, range: colors, legend: true },
                marks: [
                  Plot.areaY(flat, { x: "t", y1: "lo", y2: "hi", fill: "group", fillOpacity: 0.12, curve: "step-after" }),
                  Plot.lineY(flat, { x: "t", y: "cum", stroke: "group", strokeWidth: 2, curve: "step-after" }),
                  Plot.ruleY([0], { stroke: "var(--line)" }),
                  Plot.tip(
                    flat,
                    Plot.pointerX({
                      x: "t",
                      y: "cum",
                      stroke: "group",
                      title: (r: { group: string; t: number; cum: number }) => `${r.group}\n${r.t} years: ${(r.cum * 100).toFixed(1)}%`,
                    }),
                  ),
                ],
              })}
            />
          </div>
        </ChartFrame>

        <ChartFrame
          title="Hazard ratios (Cox proportional hazards)"
          rows={hr.map((h) => ({
            covariate: nice(h.covariate),
            hazard_ratio: +h.hr.toFixed(3),
            ci_low: +h.lo.toFixed(3),
            ci_high: +h.hi.toFixed(3),
            p: +h.p.toPrecision(3),
          }))}
          filename="cox-hazard-ratios"
          explain={
            <>
              A hazard ratio above 1 means the trait goes with winning a major award <em>sooner</em>, holding the others fixed; below 1
              means later or never. Bars are 95% confidence intervals: if a bar crosses the dashed line at 1, we can't tell it apart from no
              effect.
              {top && (
                <>
                  {" "}
                  Having a laureate advisor multiplies the yearly chance of recognition by about{" "}
                  <b className="text-text">{top.hr.toFixed(1)}×</b> (95% CI {top.lo.toFixed(1)}–{top.hi.toFixed(1)}).
                </>
              )}{" "}
              These are associations, not causes. Fame makes both the advisor link and the award more likely to be recorded.
            </>
          }
        >
          <div data-testid="forest-plot">
            <PlotFigure
              height={Math.max(260, hr.length * 22 + 40)}
              deps={[hr, dark]}
              make={(width) => ({
                marginLeft: Math.min(230, width * 0.4),
                x: { type: "log", label: "Hazard ratio (log scale) →", grid: true },
                y: { domain: hr.map((h) => nice(h.covariate)), label: null },
                marks: [
                  Plot.ruleX([1], { stroke: "var(--muted)", strokeDasharray: "4 3" }),
                  Plot.ruleY(hr, {
                    y: (h: (typeof hr)[number]) => nice(h.covariate),
                    x1: "lo",
                    x2: "hi",
                    stroke: (h: (typeof hr)[number]) => (h.p < 0.05 ? "var(--gold)" : "var(--muted)"),
                    strokeWidth: 2,
                  }),
                  Plot.dot(hr, {
                    y: (h: (typeof hr)[number]) => nice(h.covariate),
                    x: "hr",
                    r: 4.5,
                    fill: (h: (typeof hr)[number]) => (h.p < 0.05 ? "var(--gold)" : "var(--muted)"),
                    stroke: "var(--bg)",
                  }),
                  Plot.tip(
                    hr,
                    Plot.pointerY({
                      y: (h: (typeof hr)[number]) => nice(h.covariate),
                      x: "hr",
                      title: (h: (typeof hr)[number]) =>
                        `${nice(h.covariate)}\nHR ${h.hr.toFixed(2)} (${h.lo.toFixed(2)}–${h.hi.toFixed(2)})\np = ${h.p.toPrecision(2)}`,
                    }),
                  ),
                ],
              })}
            />
          </div>
          <p className="mt-2 text-xs text-muted">
            Gold = p &lt; 0.05. Reference groups: born in another/unknown country, earliest cohort, field other/unknown.
            {d.cox["ph_assumption_violations_p<0.01"].length > 0 && (
              <>
                {" "}
                Proportional-hazards check flags: {d.cox["ph_assumption_violations_p<0.01"].map(nice).join(", ")}. Read their ratios as
                time-averaged.
              </>
            )}
          </p>
        </ChartFrame>
        <p className="text-sm text-muted">
          Raw rates: {fmtPct(d.event_rates.laureate_advisor?.["1"] ?? 0, 1)} of people with a laureate advisor won a major award, vs{" "}
          {fmtPct(d.event_rates.laureate_advisor?.["0"] ?? 0, 1)} of everyone else in the cohort.
        </p>
      </div>
    </div>
  );
}
