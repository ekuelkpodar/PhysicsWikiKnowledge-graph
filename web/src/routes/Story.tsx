import Graph from "graphology";
import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import Sigma from "sigma";
import { animateNodes } from "sigma/utils";
import { LoadingBlock } from "../components/ui";
import { fmtPct } from "../lib/format";
import { communityColor, CYAN_DARK, CYAN_LIGHT, GOLD_DARK, GOLD_LIGHT } from "../lib/palette";
import { useApp, type Core } from "../lib/store";
import { FLAG } from "../lib/types";

type Mode = "dots" | "lineage" | "map" | "recognition" | "missing" | "explore";

export default function Story() {
  const { core } = useApp();
  const [step, setStep] = useState(0);
  const refs = useRef<(HTMLElement | null)[]>([]);
  const loc = useLocation();

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setStep(Number((e.target as HTMLElement).dataset.step));
        });
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    refs.current.forEach((r) => r && io.observe(r));
    return () => io.disconnect();
  }, [core]);

  // The hero paints immediately (fast FCP); the data-driven steps follow once loaded.
  if (!core)
    return (
      <div data-testid="story">
        <Hero />
        <div className="mx-auto max-w-xl px-10">
          <LoadingBlock rows={3} label="Loading the story" />
        </div>
      </div>
    );
  const s = core.meta.counts;
  const st = core.meta.story ?? {};

  const steps: { mode: Mode; kicker: string; title: string; body: React.ReactNode }[] = [
    {
      mode: "dots",
      kicker: "1 · The dataset",
      title: `${(s.seed ?? 0).toLocaleString()} physicists`,
      body: (
        <>
          Every dot is a person Wikidata calls a <em>physicist</em> and who has an English Wikipedia article, from Thales to people born in
          the 2000s. Plus {(s.expanded ?? 0).toLocaleString()} advisors and students reached through their academic links. Only{" "}
          {(s.core ?? 0).toLocaleString()} are core physicists by field, award or employer. The tag is generous.
        </>
      ),
    },
    {
      mode: "lineage",
      kicker: "2 · Who trained whom",
      title: `${(s.advised ?? 0).toLocaleString()} advisor → student links`,
      body: (
        <>
          Doctoral advisor links, stitched together from both directions because Wikidata often records only one side. The largest family
          has {Number(st.largest_component ?? 0).toLocaleString()} people.{" "}
          {st.top_founder ? (
            <>
              The most prolific lineage, from <b>{st.top_founder}</b>, reaches {Number(st.top_founder_desc).toLocaleString()} academic
              descendants.
            </>
          ) : null}
        </>
      ),
    },
    {
      mode: "map",
      kicker: "3 · Where they moved",
      title: "Born here, worked there",
      body: (
        <>
          Each dot jumps to its birthplace. {fmtPct(Number(st.cross_border_share ?? 0))} of recorded jobs were taken in a different country
          than the one the person was born in.{" "}
          {st.nazi_share ? (
            <>
              Between 1933 and 1945 that share among Central Europeans jumped to <b>{fmtPct(Number(st.nazi_share))}</b>.
            </>
          ) : null}
        </>
      ),
    },
    {
      mode: "recognition",
      kicker: "4 · Who got recognised",
      title: `${(s.laureates ?? 0).toLocaleString()} laureates`,
      body: (
        <>
          Gold dots hold a major award: Nobel, Wolf, Dirac, Fields, Planck Medal and others.{" "}
          {st.laureate_advisor_hr ? (
            <>
              Physicists whose advisor was a laureate win their first major award at about{" "}
              <b>{Number(st.laureate_advisor_hr).toFixed(1)}×</b> the rate of comparable peers.
            </>
          ) : null}
        </>
      ),
    },
    {
      mode: "missing",
      kicker: "5 · What's missing",
      title: "The gaps are part of the story",
      body: (
        <>
          {Number(st.conflicts ?? 0).toLocaleString()} people have contradictory dates, {Number(st.year_only ?? 0).toLocaleString()} births
          are known only to the year, and most people have no recorded advisor at all. A link-prediction model proposes{" "}
          {Number(st.predicted ?? 0)} missing advisor links (dashed cyan), each with evidence to check.
        </>
      ),
    },
    {
      mode: "explore",
      kicker: "6 · Your turn",
      title: "Explore the graph",
      body: (
        <>
          Drag the time slider to watch the field grow, search any name with ⌘K, or follow a lineage.
          <div className="mt-5">
            <Link
              to={{ pathname: "/graph", search: loc.search }}
              className="inline-flex items-center gap-2 rounded-lg bg-gold px-4 py-2 font-medium text-bg hover:brightness-110"
            >
              Explore the graph →
            </Link>
          </div>
        </>
      ),
    },
  ];

  return (
    <div className="relative" data-testid="story">
      <div className="pointer-events-none sticky top-0 h-[calc(100vh-150px)] w-full">
        <StoryCanvas core={core} mode={steps[step].mode} />
      </div>
      <div className="relative -mt-[calc(100vh-150px)] pb-[30vh]">
        <Hero />
        {steps.map((sp, k) => (
          <section key={k} ref={(el) => void (refs.current[k] = el)} data-step={k} className="flex min-h-[85vh] items-center px-6 md:px-16">
            <motion.div
              initial={{ opacity: 0.25, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ amount: 0.6 }}
              transition={{ duration: 0.4 }}
              className="max-w-md rounded-2xl border border-line bg-bg/85 p-6 shadow-xl backdrop-blur"
            >
              <p className="mb-2 text-xs tracking-[0.2em] text-gold uppercase">{sp.kicker}</p>
              <h2 className="font-display text-3xl leading-tight">{sp.title}</h2>
              <div className="mt-3 leading-relaxed text-muted">{sp.body}</div>
            </motion.div>
          </section>
        ))}
      </div>
    </div>
  );
}

function StoryCanvas({ core, mode }: { core: Core; mode: Mode }) {
  const ref = useRef<HTMLDivElement>(null);
  const sigma = useRef<Sigma | null>(null);
  const { theme } = useApp();
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const p = core.people;
  const extra = core;

  const topLineage = useMemo(() => {
    // the component reachable from the most-descendant founder
    let best = 0;
    for (let i = 0; i < p.n; i++) if (p.d[i] > p.d[best]) best = i;
    const set = new Set([best]);
    const stack = [best];
    while (stack.length) {
      const u = stack.pop()!;
      for (const v of core.adj.students[u])
        if (!set.has(v)) {
          set.add(v);
          stack.push(v);
        }
    }
    return set;
  }, [core, p]);

  const graph = useMemo(() => {
    const g = new Graph();
    for (let i = 0; i < p.n; i++) {
      g.addNode(String(i), { x: core.layout.x[i], y: core.layout.y[i], size: 1.2 + Math.min(10, Math.sqrt(p.d[i]) * 0.4) });
    }
    const a = core.edges.advised;
    for (let k = 0; k + 1 < a.length; k += 2) {
      const key = `${a[k]}>${a[k + 1]}`;
      if (!g.hasEdge(key)) g.addDirectedEdgeWithKey(key, String(a[k]), String(a[k + 1]), { size: 0.5 });
    }
    const pr = core.edges.predicted;
    for (let k = 0; k + 2 < pr.length; k += 3) {
      const key = `p${pr[k]}>${pr[k + 1]}`;
      if (!g.hasEdge(String(pr[k]), String(pr[k + 1])))
        g.addDirectedEdgeWithKey(key, String(pr[k]), String(pr[k + 1]), { size: 1, predicted: true });
    }
    return g;
  }, [core, p]);

  useEffect(() => {
    if (!ref.current) return;
    const s = new Sigma(graph, ref.current, {
      renderLabels: false,
      enableEdgeEvents: false,
      zIndex: true,
      nodeReducer: (n, data) => {
        const i = Number(n);
        const m = modeRef.current;
        const dark = themeRef.current === "dark";
        const dim = dark ? "#2a3240" : "#d6cdb9";
        const laur = p.f[i] & FLAG.laureate;
        const gold = dark ? GOLD_DARK : GOLD_LIGHT;
        let color = dark ? "#7d8698" : "#6a7184";
        let zIndex = 1;
        if (m === "lineage")
          color = topLineage.has(i)
            ? gold
            : core.adj.students[i].length || core.adj.advisors[i].length
              ? dark
                ? "#9aa3b5"
                : "#4a5468"
              : dim;
        if (m === "map") color = communityColor(p.fc[i], dark);
        if (m === "recognition") {
          color = laur ? gold : dim;
          zIndex = laur ? 2 : 0;
        }
        if (m === "missing") {
          color = p.f[i] & (FLAG.quality | FLAG.conflict) ? (dark ? "#f08a6c" : "#a3341f") : dim;
        }
        if (m === "explore") color = laur ? gold : communityColor(p.fc[i], dark);
        return { ...data, color, zIndex, hidden: m === "map" && extra.geo?.lat[i] == null };
      },
      edgeReducer: (e, data) => {
        const m = modeRef.current;
        const dark = themeRef.current === "dark";
        if (data.predicted) return { ...data, hidden: m !== "missing", color: dark ? CYAN_DARK : CYAN_LIGHT, size: 1.4 };
        if (m === "lineage" || m === "explore") {
          const [a] = e.split(">");
          const hot = m === "lineage" && topLineage.has(Number(a));
          return {
            ...data,
            color: hot ? (dark ? "rgba(224,181,90,0.5)" : "rgba(168,119,15,0.5)") : dark ? "rgba(233,223,199,0.12)" : "rgba(27,33,48,0.14)",
          };
        }
        return { ...data, hidden: true };
      },
    });
    s.getCamera().setState({ ratio: 1.05 });
    sigma.current = s;
    return () => s.kill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  useEffect(() => {
    const s = sigma.current;
    if (!s) return;
    const targets: Record<string, { x: number; y: number }> = {};
    const geo = extra.geo;
    let minY = Infinity,
      maxY = -Infinity,
      minX = Infinity,
      maxX = -Infinity;
    for (let i = 0; i < p.n; i++) {
      minX = Math.min(minX, core.layout.x[i]);
      maxX = Math.max(maxX, core.layout.x[i]);
      minY = Math.min(minY, core.layout.y[i]);
      maxY = Math.max(maxY, core.layout.y[i]);
    }
    const sx = (maxX - minX) / 360;
    const sy = (maxY - minY) / 180;
    for (let i = 0; i < p.n; i++) {
      if (mode === "map" && geo && geo.lat[i] != null && geo.lon[i] != null) {
        targets[String(i)] = { x: minX + (geo.lon[i]! + 180) * sx, y: minY + (geo.lat[i]! + 90) * sy * 0.75 };
      } else targets[String(i)] = { x: core.layout.x[i], y: core.layout.y[i] };
    }
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const stop = animateNodes(graph, targets, { duration: reduce ? 0 : 1100, easing: "cubicInOut" });
    s.refresh({ skipIndexation: true });
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    sigma.current?.refresh({ skipIndexation: true });
  }, [theme]);

  return <div ref={ref} className="absolute inset-y-0 right-0 left-0 opacity-90 md:left-[38%]" aria-hidden />;
}

function Hero() {
  return (
    <section className="flex min-h-[70vh] items-center px-6 md:px-16">
      <div className="max-w-xl">
        <p className="mb-3 text-xs tracking-[0.25em] text-gold uppercase">An archive of who taught whom</p>
        <h1 className="font-display text-5xl leading-[1.05] md:text-7xl">
          The Physics
          <br />
          <span className="text-gold italic">Family Tree</span>
        </h1>
        <p className="mt-5 max-w-md text-lg text-muted">
          Twelve thousand physicists, the advisors who trained them, where they went and who got recognised, rebuilt from Wikidata.
        </p>
        <p className="mt-8 text-sm text-muted" aria-hidden>
          Scroll ↓
        </p>
      </div>
    </section>
  );
}
