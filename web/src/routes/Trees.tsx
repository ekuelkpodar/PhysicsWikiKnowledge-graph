import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChartFrame } from "../components/ChartFrame";
import { PersonPicker } from "../components/PersonPicker";
import { TidyTree } from "../components/TidyTree";
import { Avatar, Button, EmptyState, ErrorState, LoadingBlock, PageHeader } from "../components/ui";
import { useJSON } from "../lib/data";
import { fmtLife, fmtPct } from "../lib/format";
import { countTree, descendantTree, pathDirections, shortestPath } from "../lib/genealogy";
import { useApp, type Core } from "../lib/store";
import { FLAG } from "../lib/types";

export interface Founder {
  i: number;
  qid: string;
  name: string;
  birth_year: number | null;
  death_year: number | null;
  descendants: number;
  descendant_laureates: number;
  descendant_nobels: number;
  yield: number;
  yield_smoothed: number;
  lift: number;
  is_root: boolean;
  generation: number;
  subtree_height: number;
}
export interface GenealogyData {
  summary: Record<string, number>;
  leaderboard: Founder[];
}

type SortKey = "yield_smoothed" | "descendant_laureates" | "descendants";

export default function Trees() {
  const { core } = useApp();
  const res = useJSON<GenealogyData>("genealogy.json");
  const [params, setParams] = useSearchParams();
  const [sort, setSort] = useState<SortKey>("yield_smoothed");
  const [layout, setLayout] = useState<"radial" | "horizontal">("radial");

  const rows = useMemo(() => {
    if (!res.data) return [];
    return [...res.data.leaderboard].sort((a, b) => b[sort] - a[sort]).slice(0, 40);
  }, [res.data, sort]);
  const founderQ = params.get("founder");
  const founder = core && founderQ ? (core.index.get(founderQ) ?? null) : (rows[0]?.i ?? null);
  const setFounder = (i: number) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set("founder", core!.people.id[i]);
        return n;
      },
      { replace: true },
    );

  if (res.error) return <ErrorState error={res.error} />;
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 md:px-8">
      <PageHeader kicker="Academic genealogy" title="Family trees of physics">
        Who founded the most productive lineages? <b className="text-text">Yield</b> is the share of a founder's academic descendants who
        hold a major award, shrunk toward the overall rate ({res.data ? fmtPct(res.data.summary.base_laureate_rate_in_trees, 1) : "…"}) so
        that a tiny tree with one laureate doesn't top the chart. Only trees with at least {res.data?.summary.min_founder_tree ?? 20}{" "}
        descendants are ranked.
      </PageHeader>
      {!res.data || !core ? (
        <LoadingBlock rows={8} />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
          <ChartFrame
            title="Founders leaderboard"
            rows={rows.map((r) => ({
              name: r.name,
              lifespan: fmtLife(r.birth_year, r.death_year),
              descendants: r.descendants,
              descendant_laureates: r.descendant_laureates,
              yield: +r.yield.toFixed(4),
              yield_smoothed: +r.yield_smoothed.toFixed(4),
              lift_vs_base: +r.lift.toFixed(2),
            }))}
            filename="founders"
          >
            <div className="mb-2 flex gap-1 text-xs" role="group" aria-label="Sort by">
              {(
                [
                  ["yield_smoothed", "Yield"],
                  ["descendant_laureates", "Laureates"],
                  ["descendants", "Tree size"],
                ] as [SortKey, string][]
              ).map(([k, l]) => (
                <Button key={k} variant={sort === k ? "solid" : "outline"} onClick={() => setSort(k)} aria-pressed={sort === k}>
                  {l}
                </Button>
              ))}
            </div>
            <ol className="max-h-[640px] space-y-1 overflow-y-auto pr-1">
              {rows.map((r, n) => (
                <li key={r.qid}>
                  <button
                    type="button"
                    onClick={() => setFounder(r.i)}
                    aria-current={founder === r.i}
                    className={
                      "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors " +
                      (founder === r.i ? "bg-surface-2" : "hover:bg-surface-2/60")
                    }
                  >
                    <span className="w-5 text-right text-xs text-muted tabular-nums">{n + 1}</span>
                    <Avatar name={r.name} img={core.people.img[r.i] || undefined} size={30} gold={!!(core.people.f[r.i] & FLAG.laureate)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{r.name}</span>
                      <span className="block text-xs text-muted">
                        {r.descendants.toLocaleString()} descendants · <span className="text-gold">{r.descendant_laureates} laureates</span>
                      </span>
                    </span>
                    <Bar
                      value={sort === "yield_smoothed" ? r.yield_smoothed : sort === "descendants" ? r.descendants : r.descendant_laureates}
                      max={rows[0][sort]}
                    />
                  </button>
                </li>
              ))}
            </ol>
          </ChartFrame>
          <div className="min-w-0 space-y-6">
            {founder !== null && <FounderTree core={core} founder={founder} layout={layout} setLayout={setLayout} />}
            <PathFinder core={core} />
          </div>
        </div>
      )}
    </div>
  );
}

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-line sm:block" aria-hidden>
      <span className="block h-full rounded-full bg-gold" style={{ width: `${(100 * value) / (max || 1)}%` }} />
    </span>
  );
}

function FounderTree({
  core,
  founder,
  layout,
  setLayout,
}: {
  core: Core;
  founder: number;
  layout: "radial" | "horizontal";
  setLayout: (l: "radial" | "horizontal") => void;
}) {
  const { select } = useApp();
  const tree = useMemo(() => descendantTree(core.adj, founder, 8, 1200), [core, founder]);
  const p = core.people;
  const n = countTree(tree) - 1;
  const laureates = useMemo(() => {
    const out: number[] = [];
    const walk = (t: typeof tree) => {
      if (t.id !== founder && p.f[t.id] & FLAG.laureate) out.push(t.id);
      t.children.forEach(walk);
    };
    walk(tree);
    return out;
  }, [tree, p, founder]);
  return (
    <ChartFrame
      title={`The ${p.name[founder]} tree`}
      rows={laureates.map((i) => ({ name: p.name[i], lifespan: fmtLife(p.by[i], p.dy[i]), qid: p.id[i] }))}
      columns={["name", "lifespan", "qid"]}
      filename={`tree-${p.id[founder]}`}
      explain={
        <>
          {n.toLocaleString()} descendants shown (up to 8 generations). Gold nodes are laureates ({laureates.length}). Click a name to open
          them; Shift+click or Space folds a branch. The data table lists the laureates in this tree.
        </>
      }
    >
      <div className="mb-2 flex gap-1">
        <Button variant={layout === "radial" ? "solid" : "outline"} onClick={() => setLayout("radial")} aria-pressed={layout === "radial"}>
          Radial
        </Button>
        <Button
          variant={layout === "horizontal" ? "solid" : "outline"}
          onClick={() => setLayout("horizontal")}
          aria-pressed={layout === "horizontal"}
        >
          Horizontal
        </Button>
      </div>
      <div data-testid="founder-tree">
        <TidyTree
          key={`${founder}-${layout}`}
          title={`Descendant tree of ${p.name[founder]}`}
          root={tree}
          people={p}
          layout={layout}
          onSelect={select}
          initialDepth={layout === "radial" ? 8 : 3}
          levelGap={layout === "radial" ? 70 : 40}
          nodeGap={layout === "radial" ? 12 : 16}
          showLabels={layout === "horizontal" ? true : "auto"}
        />
      </div>
    </ChartFrame>
  );
}

function PathFinder({ core }: { core: Core }) {
  const { select } = useApp();
  const p = core.people;
  const [a, setA] = useState<number | null>(() => core.index.get("Q937") ?? null); // Einstein
  const [b, setB] = useState<number | null>(() => core.index.get("Q9095") ?? null); // Dirac
  const path = useMemo(() => (a !== null && b !== null ? shortestPath(core.adj, a, b) : null), [a, b, core]);
  const dirs = useMemo(() => (path ? pathDirections(core.adj, path) : []), [path, core]);
  return (
    <section className="rounded-xl border border-line bg-surface/60 p-5" aria-label="Path finder">
      <h2 className="font-display text-xl">Path finder</h2>
      <p className="mb-3 text-sm text-muted">The shortest chain of advisor–student links connecting any two people.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <PersonPicker core={core} value={a} onChange={setA} label="From" />
        <PersonPicker core={core} value={b} onChange={setB} label="To" />
      </div>
      <div className="mt-5" aria-live="polite">
        {a !== null && b !== null && !path && (
          <EmptyState title="No connection">
            {p.name[a]} and {p.name[b]} are in separate genealogy components. Wikidata has no recorded advisor chain between them.
          </EmptyState>
        )}
        {path && (
          <ol className="flex flex-wrap items-center gap-2" data-testid="path">
            {path.map((i, k) => (
              <motion.li
                key={`${i}-${k}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: k * 0.12 }}
                className="flex items-center gap-2"
              >
                {k > 0 && (
                  <span className="text-xs text-muted" title={dirs[k - 1] === "down" ? "advised" : "was advised by"}>
                    {dirs[k - 1] === "down" ? "→ advised →" : "← student of ←"}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => select(i)}
                  className={
                    "flex items-center gap-2 rounded-full border px-2 py-1 text-sm hover:bg-surface-2 " +
                    (p.f[i] & FLAG.laureate ? "border-gold/50 text-gold" : "border-line")
                  }
                >
                  <Avatar name={p.name[i]} img={p.img[i] || undefined} size={22} />
                  {p.name[i]}
                </button>
              </motion.li>
            ))}
          </ol>
        )}
        {path && <p className="mt-3 text-xs text-muted">{path.length - 1} links.</p>}
      </div>
    </section>
  );
}
