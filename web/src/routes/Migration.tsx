import { COORDINATE_SYSTEM } from "@deck.gl/core";
import { ArcLayer, GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";
import DeckGL from "@deck.gl/react";
import type { FeatureCollection } from "geojson";
import { useEffect, useMemo, useState } from "react";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import world from "world-atlas/countries-110m.json";
import { ChartFrame } from "../components/ChartFrame";
import { Sankey } from "../components/Sankey";
import { Button, Chip, ErrorState, LoadingBlock } from "../components/ui";
import { YEAR_MAX } from "../lib/filters";
import { fmtPct } from "../lib/format";
import { seriesColor } from "../lib/palette";
import { useApp } from "../lib/store";

interface Window {
  label: string;
  window: [number, number];
  baseline_window: [number, number];
  share_abroad: number | null;
  baseline_share_abroad: number | null;
  n: number;
  n_baseline: number;
  emigrants: number;
  top_destinations: Record<string, number>;
}
export interface MigrationData {
  top_countries: string[];
  sankey_by_era: Record<string, { source: string; target: string; value: number }[]>;
  sankey_by_decade: Record<string, { source: string; target: string; value: number }[]>;
  arcs: [number, number, number, number, number, number, string, string, number, number, string | null][];
  shocks_detected: {
    origin: string;
    decade: number;
    share_abroad: number;
    baseline: number;
    n: number;
    top_destinations: Record<string, number>;
  }[];
  curated_windows: Record<string, Window>;
  share_abroad_by_decade: Record<string, { n: number; share: number }>;
  notes: Record<string, number>;
}

const ERAS: [string, number, number][] = [
  ["1800-1899", 1800, 1899],
  ["1900-1932", 1900, 1932],
  ["1933-1945", 1933, 1945],
  ["1946-1990", 1946, 1990],
  ["1991-2025", 1991, 2025],
];
const WINDOW = 15;

const LAND = feature(world as unknown as Topology, (world as unknown as Topology).objects.countries) as unknown as FeatureCollection;

export default function Migration() {
  const { filters, setFilters, theme, select, core } = useApp();
  const [data, setData] = useState<MigrationData | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const [cumulative, setCumulative] = useState(false);
  const [era, setEra] = useState<string | null>(null);
  const dark = theme === "dark";
  useEffect(() => {
    import("../lib/data").then(({ loadJSON }) => loadJSON<MigrationData>("migration.json").then(setData).catch(setErr));
  }, []);

  const t = filters.year;
  const autoEra = ERAS.find(([, lo, hi]) => t >= lo && t <= hi)?.[0] ?? "1946-1990";
  const activeEra = era ?? (t >= YEAR_MAX ? "1933-1945" : autoEra);

  const arcs = useMemo(() => {
    if (!data) return [];
    const all = t >= YEAR_MAX || cumulative;
    return data.arcs.filter((a) => (all ? a[1] <= t : a[1] <= t && a[1] > t - WINDOW));
  }, [data, t, cumulative]);

  const colorIdx = useMemo(() => new Map((data?.top_countries ?? []).map((c, i) => [c, i])), [data]);
  const countryColor = (c: string) => {
    const i = colorIdx.get(c);
    return i !== undefined && i < 6 ? seriesColor(i, dark) : dark ? "#6b7383" : "#9a927f";
  };

  if (err) return <ErrorState error={err} />;
  if (!data || !core)
    return (
      <div className="p-8">
        <LoadingBlock rows={10} label="Loading migration data" />
      </div>
    );

  // many arcs at once -> fainter, so the whole-history view reads as density, not a mesh
  const fade = Math.min(1, Math.max(0.35, 600 / Math.max(arcs.length, 1)));
  const gold: [number, number, number] = dark ? [224, 181, 90] : [168, 119, 15];
  const cyan: [number, number, number] = dark ? [95, 212, 230] : [11, 111, 128];
  const layers = [
    new GeoJsonLayer({
      id: "land",
      data: LAND,
      stroked: true,
      filled: true,
      getFillColor: dark ? [26, 34, 46, 255] : [233, 226, 210, 255],
      getLineColor: dark ? [60, 72, 90, 255] : [200, 190, 170, 255],
      lineWidthMinPixels: 0.5,
      coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
    }),
    new ArcLayer({
      id: "arcs",
      data: arcs,
      greatCircle: true,
      getSourcePosition: (a: MigrationData["arcs"][number]) => [a[2], a[3]],
      getTargetPosition: (a: MigrationData["arcs"][number]) => [a[4], a[5]],
      getSourceColor: (a: MigrationData["arcs"][number]) =>
        [...(a[8] ? gold : cyan), (a[8] ? 150 : 30) * fade] as [number, number, number, number],
      getTargetColor: (a: MigrationData["arcs"][number]) =>
        [...(a[8] ? gold : cyan), (a[8] ? 220 : 110) * fade] as [number, number, number, number],
      getWidth: (a: MigrationData["arcs"][number]) => (a[8] ? 1.8 : 1),
      widthUnits: "pixels",
      pickable: true,
      updateTriggers: { getSourceColor: [dark, fade], getTargetColor: [dark, fade] },
      transitions: { getSourceColor: 300 },
    }),
    new ScatterplotLayer({
      id: "dest",
      data: arcs,
      getPosition: (a: MigrationData["arcs"][number]) => [a[4], a[5]],
      getRadius: 2,
      radiusUnits: "pixels",
      getFillColor: (a: MigrationData["arcs"][number]) => [...(a[8] ? gold : cyan), 200] as [number, number, number, number],
      updateTriggers: { getFillColor: [dark] },
    }),
  ];

  const eraLinks = data.sankey_by_era[activeEra] ?? [];
  const moved = eraLinks
    .filter((l) => l.source !== l.target)
    .map((l) => ({ source: `o:${l.source}`, target: `d:${l.target}`, value: l.value }));
  const nazi = data.curated_windows.nazi_era;
  const soviet = data.curated_windows.post_soviet;

  return (
    <div className="flex h-full flex-col lg:flex-row" data-testid="migration">
      <div className="relative hidden min-h-[320px] flex-1 md:block">
        <DeckGL
          layers={layers}
          initialViewState={{ longitude: 5, latitude: 28, zoom: 0.85, pitch: 0, bearing: 0, minZoom: 0.5 }}
          controller={{ dragRotate: false }}
          getTooltip={({ object }) =>
            object && Array.isArray(object)
              ? {
                  html: `<b>${core.people.name[(object as MigrationData["arcs"][number])[0]] ?? ""}</b><br/>${object[6]} → ${object[10] ?? object[7]} (${object[1]})`,
                  style: {
                    background: dark ? "#121821" : "#fbf8f1",
                    color: dark ? "#ebe2cc" : "#1b2130",
                    fontSize: "12px",
                    borderRadius: "8px",
                    border: "1px solid rgba(128,128,128,.3)",
                  },
                }
              : null
          }
          onClick={({ object }) => object && Array.isArray(object) && select(object[0] as number)}
          style={{ background: dark ? "#0b0f14" : "#f4eee1" }}
          aria-label="Map of moves from birthplace to workplace"
        />
        <div className="pointer-events-none absolute top-3 left-3 rounded-lg border border-line bg-surface/90 p-3 text-xs backdrop-blur">
          <div className="font-display text-2xl text-text tabular-nums">
            {t >= YEAR_MAX ? "All years" : `${cumulative ? "≤" : `${t - WINDOW + 1}–`}${t}`}
          </div>
          <div className="text-muted">{arcs.length.toLocaleString()} moves shown (birthplace → employer)</div>
          <div className="mt-1 flex gap-3">
            <span className="flex items-center gap-1">
              <span className="h-0.5 w-4" style={{ background: `rgb(${gold})` }} />
              laureate
            </span>
            <span className="flex items-center gap-1">
              <span className="h-0.5 w-4" style={{ background: `rgb(${cyan})` }} />
              other
            </span>
          </div>
        </div>
        <div className="absolute bottom-3 left-3 flex gap-2">
          <Button variant="outline" className="bg-surface/90" onClick={() => setCumulative((c) => !c)} aria-pressed={cumulative}>
            {cumulative ? "Cumulative" : `${WINDOW}-year window`}
          </Button>
          <Button variant="outline" className="bg-surface/90" onClick={() => setFilters({ year: 1925 })}>
            Jump to 1925
          </Button>
        </div>
        <p className="absolute right-2 bottom-1 text-[10px] text-muted">Natural Earth · today's borders</p>
      </div>
      <aside className="w-full overflow-y-auto border-l border-line p-4 lg:w-[540px]">
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <Callout w={nazi} onJump={() => setFilters({ year: 1945 })} origin="Germany, Austria, Hungary, Czechia, Poland" />
          <Callout w={soviet} onJump={() => setFilters({ year: 2005 })} origin="former Soviet republics" />
        </div>
        <ChartFrame
          title="Where they were born → where they worked"
          rows={eraLinks.map((l) => ({ era: activeEra, from: l.source, to: l.target, people: l.value }))}
          filename={`migration-${activeEra}`}
          explain={
            <>
              Each person–employer pair counts once. Cross-border moves only; {fmtPct(data.notes.start_year_imputed_share)} of start years
              are imputed as birth + 27 when Wikidata has no date. Countries use today's borders.
            </>
          }
        >
          <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label="Era">
            {ERAS.map(([k]) => (
              <Button
                key={k}
                variant={activeEra === k ? "solid" : "outline"}
                onClick={() => setEra(k)}
                aria-pressed={activeEra === k}
                className="text-xs"
              >
                {k}
              </Button>
            ))}
          </div>
          {moved.length ? (
            <Sankey
              title={`Cross-border moves ${activeEra}`}
              links={moved}
              colorOf={(id) => countryColor(id.slice(2))}
              height={Math.min(560, 120 + moved.length * 9)}
            />
          ) : (
            <p className="text-sm text-muted">No cross-border moves recorded in this era.</p>
          )}
        </ChartFrame>
        {data.shocks_detected.length > 0 && (
          <section className="mt-4 rounded-xl border border-line p-4">
            <h2 className="font-display text-lg">Detected emigration spikes</h2>
            <p className="mb-2 text-xs text-muted">
              Decades where a country's share of people taking jobs abroad jumped far above its own median.
            </p>
            <ul className="space-y-1.5 text-sm">
              {data.shocks_detected.slice(0, 8).map((s) => (
                <li key={`${s.origin}${s.decade}`} className="flex flex-wrap items-center gap-2">
                  <button type="button" className="text-cyan hover:underline" onClick={() => setFilters({ year: s.decade + 9 })}>
                    {s.origin}, {s.decade}s
                  </button>
                  <Chip tone="gold">
                    {fmtPct(s.share_abroad)} abroad vs {fmtPct(s.baseline)} usual
                  </Chip>
                  <span className="text-xs text-muted">→ {Object.keys(s.top_destinations).slice(0, 2).join(", ")}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}

function Callout({ w, onJump, origin }: { w: Window; onJump: () => void; origin: string }) {
  if (!w || w.share_abroad === null) return null;
  return (
    <button type="button" onClick={onJump} className="rounded-xl border border-gold/40 bg-gold/5 p-3 text-left hover:bg-gold/10">
      <div className="text-xs tracking-wide text-gold uppercase">{w.label}</div>
      <div className="mt-1 font-display text-2xl">{fmtPct(w.share_abroad)}</div>
      <div className="text-xs text-muted">
        of people born in {origin} who started a job in {w.window[0]}–{w.window[1]} took it abroad, vs{" "}
        {fmtPct(w.baseline_share_abroad ?? 0)} in {w.baseline_window[0]}–{w.baseline_window[1]} (n={w.n}). Top destinations:{" "}
        {Object.keys(w.top_destinations).slice(0, 3).join(", ")}.
      </div>
    </button>
  );
}
