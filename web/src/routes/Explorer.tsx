import Graph from "graphology";
import { useEffect, useMemo, useRef, useState } from "react";
import Sigma from "sigma";
import { animateNodes } from "sigma/utils";
import { Button, Chip, EmptyState, IconX, LoadingBlock } from "../components/ui";
import { DEFAULT_FILTERS } from "../lib/filters";
import { fmtLife, fmtPct } from "../lib/format";
import { communityColor, CYAN_DARK, CYAN_LIGHT, GOLD_DARK, GOLD_LIGHT } from "../lib/palette";
import { useApp, type Core } from "../lib/store";
import { FLAG } from "../lib/types";

type SizeMode = "descendants" | "pagerank";
type LayoutMode = "force" | "generations";

export default function Explorer() {
  const { core, error } = useApp();
  const isMobile = useMediaQuery("(max-width: 767px)");
  if (error) return <EmptyState title="Couldn't load the graph">{error.message}</EmptyState>;
  if (!core) return <GraphSkeleton />;
  return isMobile ? <MobileList core={core} /> : <GraphCanvas core={core} />;
}

function GraphSkeleton() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-80">
        <LoadingBlock label="Loading graph" rows={3} />
      </div>
    </div>
  );
}

/** Layout positions. Generations: x = birth year, y = academic generation (+ force jitter). */
function positions(core: Core, mode: LayoutMode) {
  const { people, layout } = core;
  const xs = layout.x;
  const ys = layout.y;
  if (mode === "force") return { x: xs, y: ys };
  let minY = Infinity;
  let maxY = -Infinity;
  for (const v of ys) {
    minY = Math.min(minY, v);
    maxY = Math.max(maxY, v);
  }
  const span = maxY - minY || 1;
  const gx: number[] = [];
  const gy: number[] = [];
  for (let i = 0; i < people.n; i++) {
    const by = people.by[i] ?? 1500;
    const yr = Math.max(1500, by);
    gx.push(((yr - 1500) / 525) * span * 1.6);
    gy.push(-people.g[i] * span * 0.09 + ((ys[i] - minY) / span - 0.5) * span * 0.06);
  }
  return { x: gx, y: gy };
}

function nodeSize(core: Core, i: number, mode: SizeMode) {
  const p = core.people;
  if (mode === "pagerank") return 1.4 + Math.pow(p.pr[i] / 1000, 6) * 13;
  return Math.min(16, 1.4 + Math.sqrt(p.d[i]) * 0.55);
}

function GraphCanvas({ core }: { core: Core }) {
  const { visible, selected, select, theme, filters, setFilters } = useApp();
  const container = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const [hovered, setHovered] = useState<{ i: number; x: number; y: number } | null>(null);
  const [sizeMode, setSizeMode] = useState<SizeMode>("descendants");
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("force");
  const [boxMode, setBoxMode] = useState(false);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [boxSel, setBoxSel] = useState<Set<number> | null>(null);
  const state = useRef({ visible, selected, hovered: null as number | null, theme, boxSel, filters });
  state.current = { ...state.current, visible, selected, theme, boxSel, filters };
  const dark = theme === "dark";

  const graph = useMemo(() => {
    const g = new Graph({ type: "directed", multi: false });
    const pos = positions(core, "force");
    for (let i = 0; i < core.people.n; i++) {
      g.addNode(String(i), { x: pos.x[i], y: pos.y[i], size: nodeSize(core, i, "descendants"), label: core.people.name[i] });
    }
    const a = core.edges.advised;
    for (let k = 0; k + 1 < a.length; k += 2) {
      const key = `${a[k]}>${a[k + 1]}`;
      if (!g.hasEdge(key)) g.addDirectedEdgeWithKey(key, String(a[k]), String(a[k + 1]), { size: 0.6 });
    }
    return g;
  }, [core]);

  const neighbors = useMemo(() => {
    if (selected === null) return null;
    const s = new Set<number>([selected]);
    core.adj.students[selected].forEach((x) => s.add(x));
    core.adj.advisors[selected].forEach((x) => s.add(x));
    return s;
  }, [selected, core]);
  const nbRef = useRef(neighbors);
  nbRef.current = neighbors;

  // --- mount sigma once ----------------------------------------------------------
  useEffect(() => {
    if (!container.current) return;
    const p = core.people;
    const s = new Sigma(graph, container.current, {
      renderLabels: true,
      labelRenderedSizeThreshold: 11,
      labelDensity: 0.25,
      labelFont: "Inter Variable, system-ui, sans-serif",
      labelSize: 12,
      defaultEdgeColor: "#888",
      zIndex: true,
      hideEdgesOnMove: false,
      // theme-aware hover label (sigma's default draws a white box)
      defaultDrawNodeHover: (ctx, data, settings) => {
        const dark = state.current.theme === "dark";
        const size = settings.labelSize;
        ctx.font = `500 ${size}px ${settings.labelFont}`;
        const label = data.label ?? "";
        const w = ctx.measureText(label).width + 12;
        const h = size + 10;
        ctx.fillStyle = dark ? "#1a222e" : "#fbf8f1";
        ctx.strokeStyle = dark ? "rgba(233,223,199,0.25)" : "rgba(27,33,48,0.2)";
        ctx.beginPath();
        ctx.roundRect(data.x + data.size + 4, data.y - h / 2, w, h, 5);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(data.x, data.y, data.size + 2, 0, Math.PI * 2);
        ctx.strokeStyle = dark ? "#ebe2cc" : "#1b2130";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = dark ? "#ebe2cc" : "#1b2130";
        ctx.fillText(label, data.x + data.size + 10, data.y + size / 3);
      },
      minCameraRatio: 0.02,
      maxCameraRatio: 3,
      nodeReducer: (node, data) => {
        const i = Number(node);
        const st = state.current;
        const isDark = st.theme === "dark";
        const res: Record<string, unknown> = { ...data };
        if (st.visible && !st.visible[i]) return { ...data, hidden: true };
        const laureate = p.f[i] & FLAG.laureate;
        res.color = laureate ? (isDark ? GOLD_DARK : GOLD_LIGHT) : communityColor(p.fc[i], isDark);
        res.zIndex = laureate ? 2 : 1;
        const focus = nbRef.current ?? st.boxSel;
        if (focus) {
          if (focus.has(i)) {
            res.zIndex = 3;
            res.forceLabel = nbRef.current ? true : focus.size < 60;
            if (i === st.selected) res.highlighted = true;
          } else {
            res.color = isDark ? "#222a35" : "#ddd5c4";
            res.label = "";
            res.zIndex = 0;
          }
        }
        if (st.hovered === i) res.highlighted = true;
        return res;
      },
      edgeReducer: (edge, data) => {
        const st = state.current;
        const [a, b] = edge.split(">").map(Number);
        const isDark = st.theme === "dark";
        if (st.visible && (!st.visible[a] || !st.visible[b])) return { ...data, hidden: true };
        // an advising link "exists" once the student is ~25
        const sb = p.by[b];
        if (st.filters.year < 2025 && sb !== null && st.filters.year < sb + 25) return { ...data, hidden: true };
        const focus = nbRef.current;
        if (focus) {
          const on = focus.has(a) && focus.has(b) && (a === st.selected || b === st.selected);
          return { ...data, color: on ? (isDark ? "#ebe2cc" : "#1b2130") : "rgba(0,0,0,0)", size: on ? 1.6 : 0.3, hidden: !on };
        }
        return { ...data, size: 0.4, color: isDark ? "rgba(233,223,199,0.05)" : "rgba(27,33,48,0.07)" };
      },
    });
    s.on("enterNode", ({ node }) => {
      const d = s.getNodeDisplayData(node);
      if (!d) return;
      const v = s.framedGraphToViewport(d);
      state.current.hovered = Number(node);
      setHovered({ i: Number(node), x: v.x, y: v.y });
      container.current!.style.cursor = "pointer";
    });
    s.on("leaveNode", () => {
      state.current.hovered = null;
      setHovered(null);
      container.current!.style.cursor = "";
    });
    s.on("clickNode", ({ node }) => select(Number(node)));
    s.on("clickStage", () => {
      select(null);
      setBoxSel(null);
    });
    sigmaRef.current = s;
    return () => {
      s.kill();
      sigmaRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  // label colour follows theme
  useEffect(() => {
    sigmaRef.current?.setSetting("labelColor", { color: dark ? "#ebe2cc" : "#1b2130" });
  }, [dark]);

  useEffect(() => {
    sigmaRef.current?.refresh({ skipIndexation: true });
  }, [visible, selected, theme, boxSel, neighbors, filters.year]);

  // camera follows selection
  useEffect(() => {
    const s = sigmaRef.current;
    if (!s || selected === null) return;
    const d = s.getNodeDisplayData(String(selected));
    if (d) s.getCamera().animate({ x: d.x, y: d.y, ratio: Math.min(s.getCamera().ratio, 0.35) }, { duration: reduced() ? 0 : 500 });
  }, [selected]);

  // size mode
  useEffect(() => {
    graph.forEachNode((n) => graph.setNodeAttribute(n, "size", nodeSize(core, Number(n), sizeMode)));
  }, [sizeMode, graph, core]);

  // layout mode (animated)
  useEffect(() => {
    const pos = positions(core, layoutMode);
    const targets: Record<string, { x: number; y: number }> = {};
    for (let i = 0; i < core.people.n; i++) targets[String(i)] = { x: pos.x[i], y: pos.y[i] };
    const stop = animateNodes(graph, targets, { duration: reduced() ? 0 : 900, easing: "cubicInOut" });
    const t = setTimeout(() => sigmaRef.current?.getCamera().animatedReset({ duration: reduced() ? 0 : 500 }), reduced() ? 0 : 950);
    return () => {
      stop();
      clearTimeout(t);
    };
  }, [layoutMode, graph, core]);

  // predicted links: dashed cyan overlay drawn after each sigma render
  useEffect(() => {
    const s = sigmaRef.current;
    const cv = overlay.current;
    if (!s || !cv) return;
    const draw = () => {
      const dims = s.getDimensions();
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== dims.width * dpr) {
        cv.width = dims.width * dpr;
        cv.height = dims.height * dpr;
      }
      const ctx = cv.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, dims.width, dims.height);
      if (!state.current.filters.predicted) return;
      const pr = core.edges.predicted;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = state.current.theme === "dark" ? CYAN_DARK : CYAN_LIGHT;
      ctx.lineWidth = 1.4;
      const vis = state.current.visible;
      for (let k = 0; k + 2 < pr.length; k += 3) {
        const a = pr[k];
        const b = pr[k + 1];
        if (vis && (!vis[a] || !vis[b])) continue;
        const da = s.getNodeDisplayData(String(a));
        const db = s.getNodeDisplayData(String(b));
        if (!da || !db) continue;
        const pa = s.framedGraphToViewport(da);
        const pb = s.framedGraphToViewport(db);
        ctx.globalAlpha = 0.35 + 0.65 * (pr[k + 2] / 1000);
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }
    };
    s.on("afterRender", draw);
    draw();
    return () => {
      s.off("afterRender", draw);
    };
  }, [core, graph]);
  useEffect(() => {
    sigmaRef.current?.refresh({ skipIndexation: true });
  }, [filters.predicted]);

  // box select → zoom to selection
  const finishBox = () => {
    const s = sigmaRef.current;
    if (!s || !box) return;
    const [x0, x1] = [Math.min(box.x0, box.x1), Math.max(box.x0, box.x1)];
    const [y0, y1] = [Math.min(box.y0, box.y1), Math.max(box.y0, box.y1)];
    setBox(null);
    setBoxMode(false);
    if (x1 - x0 < 6 || y1 - y0 < 6) return;
    const sel = new Set<number>();
    graph.forEachNode((n) => {
      const d = s.getNodeDisplayData(n);
      if (!d || d.hidden) return;
      const v = s.framedGraphToViewport(d);
      if (v.x >= x0 && v.x <= x1 && v.y >= y0 && v.y <= y1) sel.add(Number(n));
    });
    setBoxSel(sel.size ? sel : null);
    const c = s.viewportToFramedGraph({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
    const dims = s.getDimensions();
    const cam = s.getCamera();
    const factor = Math.max((x1 - x0) / dims.width, (y1 - y0) / dims.height);
    cam.animate({ x: c.x, y: c.y, ratio: Math.max(0.02, cam.ratio * factor * 1.1) }, { duration: reduced() ? 0 : 500 });
  };

  const nVisible = useMemo(() => (visible ? visible.reduce((s, v) => s + v, 0) : core.people.n), [visible, core]);

  return (
    <div className="relative h-full w-full" data-testid="graph-explorer">
      <div
        ref={container}
        className="absolute inset-0"
        aria-label="Academic genealogy graph. Use search (⌘K) to find and open a person."
        role="img"
      />
      <canvas ref={overlay} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />
      {boxMode && (
        <div
          className="absolute inset-0 cursor-crosshair"
          onMouseDown={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setBox({ x0: e.clientX - r.left, y0: e.clientY - r.top, x1: e.clientX - r.left, y1: e.clientY - r.top });
          }}
          onMouseMove={(e) => {
            if (!box) return;
            const r = e.currentTarget.getBoundingClientRect();
            setBox({ ...box, x1: e.clientX - r.left, y1: e.clientY - r.top });
          }}
          onMouseUp={finishBox}
        >
          {box && (
            <div
              className="absolute border border-dashed border-gold bg-gold/10"
              style={{
                left: Math.min(box.x0, box.x1),
                top: Math.min(box.y0, box.y1),
                width: Math.abs(box.x1 - box.x0),
                height: Math.abs(box.y1 - box.y0),
              }}
            />
          )}
        </div>
      )}

      {nVisible === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="rounded-xl border border-line bg-surface/95 p-2">
            <EmptyState
              title="No people match these filters"
              action={
                <Button variant="outline" onClick={() => setFilters(DEFAULT_FILTERS)}>
                  Clear filters
                </Button>
              }
            >
              Move the time slider later or relax the filters.
            </EmptyState>
          </div>
        </div>
      )}

      {/* controls */}
      <div className="absolute top-3 left-3 flex flex-col gap-2">
        <div className="rounded-xl border border-line bg-surface/90 p-2 text-sm shadow-lg backdrop-blur">
          <Segmented
            label="Size"
            value={sizeMode}
            options={[
              ["descendants", "Descendants"],
              ["pagerank", "PageRank"],
            ]}
            onChange={(v) => setSizeMode(v as SizeMode)}
          />
          <Segmented
            label="Layout"
            value={layoutMode}
            options={[
              ["force", "Force"],
              ["generations", "Generations"],
            ]}
            onChange={(v) => setLayoutMode(v as LayoutMode)}
          />
          <div className="mt-1 flex gap-1">
            <Button
              variant={boxMode ? "solid" : "outline"}
              onClick={() => setBoxMode((b) => !b)}
              aria-pressed={boxMode}
              className="flex-1 justify-center"
            >
              Box zoom
            </Button>
            <Button variant="outline" onClick={() => sigmaRef.current?.getCamera().animatedReset({ duration: reduced() ? 0 : 400 })}>
              Reset
            </Button>
          </div>
          {boxSel && (
            <div className="mt-2 flex items-center justify-between text-xs text-muted">
              {boxSel.size.toLocaleString()} selected
              <button type="button" onClick={() => setBoxSel(null)} aria-label="Clear selection" className="hover:text-text">
                <IconX className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
        <Legend core={core} dark={dark} nVisible={nVisible} />
      </div>
      <Minimap core={core} sigma={sigmaRef} layoutMode={layoutMode} dark={dark} />

      {hovered && (
        <div
          className="pointer-events-none absolute z-10 w-64 rounded-lg border border-line bg-surface/95 p-3 text-sm shadow-xl backdrop-blur"
          style={{ left: Math.min(hovered.x + 14, (container.current?.clientWidth ?? 800) - 270), top: hovered.y + 14 }}
        >
          <HoverCard core={core} i={hovered.i} />
        </div>
      )}
    </div>
  );
}

function HoverCard({ core, i }: { core: Core; i: number }) {
  const p = core.people;
  const comm = core.people.communities.find((c) => c.id === p.fc[i]);
  return (
    <>
      <div className="font-display text-base leading-tight">{p.name[i]}</div>
      <div className="text-xs text-muted">{fmtLife(p.by[i], p.dy[i])}</div>
      <div className="mt-2 flex flex-wrap gap-1">
        {!!(p.f[i] & FLAG.laureate) && <Chip tone="gold">laureate</Chip>}
        {comm && <Chip>{comm.label}</Chip>}
      </div>
      {p.d[i] > 0 && (
        <div className="mt-2 text-xs">
          {p.d[i].toLocaleString()} descendants{p.dl[i] > 0 && <span className="text-gold"> · {p.dl[i]} laureates</span>}
        </div>
      )}
      <div className="mt-1 text-xs text-muted">PageRank: top {fmtPct(1 - p.pr[i] / 1000, 1)}</div>
    </>
  );
}

function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <fieldset className="mb-1.5 flex items-center gap-2">
      <legend className="sr-only">{label}</legend>
      <span className="w-12 text-xs text-muted" aria-hidden>
        {label}
      </span>
      <div className="flex rounded-md border border-line p-0.5">
        {options.map(([v, l]) => (
          <button
            key={v}
            type="button"
            aria-pressed={value === v}
            onClick={() => onChange(v)}
            className={"rounded px-2 py-0.5 text-xs " + (value === v ? "bg-surface-2 text-text" : "text-muted hover:text-text")}
          >
            {l}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Legend({ core, dark, nVisible }: { core: Core; dark: boolean; nVisible: number }) {
  const { filters, setFilters } = useApp();
  return (
    <div className="hidden max-w-[240px] rounded-xl border border-line bg-surface/90 p-3 text-xs shadow-lg backdrop-blur md:block">
      <div className="mb-2 text-muted tabular-nums">{nVisible.toLocaleString()} people visible</div>
      <ul className="space-y-1">
        <li className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: dark ? GOLD_DARK : GOLD_LIGHT }} /> Laureate (major award)
        </li>
        {core.people.communities.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className={
                "flex w-full items-center gap-2 rounded text-left hover:text-text " + (filters.field === c.id ? "text-text" : "text-muted")
              }
              onClick={() => setFilters({ field: filters.field === c.id ? null : c.id })}
              aria-pressed={filters.field === c.id}
              title={c.top_fields.join(", ")}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: communityColor(c.id, dark) }} />
              <span className="truncate">{c.label}</span>
            </button>
          </li>
        ))}
        <li className="flex items-center gap-2 text-muted">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: communityColor(-1, dark) }} /> Other / no field recorded
        </li>
        <li className="flex items-center gap-2 text-muted">
          <svg width="18" height="4" aria-hidden>
            <line x1="0" x2="18" y1="2" y2="2" stroke={dark ? CYAN_DARK : CYAN_LIGHT} strokeDasharray="3 3" strokeWidth="1.5" />
          </svg>
          Predicted advisor link
        </li>
      </ul>
      <p className="mt-2 text-muted">Node size: {"descendants or PageRank"}. Click a node to open the person.</p>
    </div>
  );
}

function Minimap({
  core,
  sigma,
  layoutMode,
  dark,
}: {
  core: Core;
  sigma: React.RefObject<Sigma | null>;
  layoutMode: LayoutMode;
  dark: boolean;
}) {
  const base = useRef<HTMLCanvasElement>(null);
  const view = useRef<HTMLCanvasElement>(null);
  const W = 180;
  const H = 130;
  const bbox = useMemo(() => {
    const pos = positions(core, layoutMode);
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    for (let i = 0; i < pos.x.length; i++) {
      x0 = Math.min(x0, pos.x[i]);
      x1 = Math.max(x1, pos.x[i]);
      y0 = Math.min(y0, pos.y[i]);
      y1 = Math.max(y1, pos.y[i]);
    }
    return { pos, x0, x1, y0, y1 };
  }, [core, layoutMode]);
  const toMini = (x: number, y: number) => {
    const s = Math.min(W / (bbox.x1 - bbox.x0), H / (bbox.y1 - bbox.y0));
    const ox = (W - (bbox.x1 - bbox.x0) * s) / 2;
    const oy = (H - (bbox.y1 - bbox.y0) * s) / 2;
    return [ox + (x - bbox.x0) * s, H - (oy + (y - bbox.y0) * s)] as const;
  };
  const fromMini = (mx: number, my: number) => {
    const s = Math.min(W / (bbox.x1 - bbox.x0), H / (bbox.y1 - bbox.y0));
    const ox = (W - (bbox.x1 - bbox.x0) * s) / 2;
    const oy = (H - (bbox.y1 - bbox.y0) * s) / 2;
    return { x: (mx - ox) / s + bbox.x0, y: (H - my - oy) / s + bbox.y0 };
  };

  useEffect(() => {
    const ctx = base.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = dark ? "rgba(233,223,199,0.35)" : "rgba(27,33,48,0.35)";
    for (let i = 0; i < bbox.pos.x.length; i++) {
      const [x, y] = toMini(bbox.pos.x[i], bbox.pos.y[i]);
      ctx.fillRect(x, y, 1, 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bbox, dark]);

  useEffect(() => {
    const s = sigma.current;
    if (!s) return;
    const draw = () => {
      const ctx = view.current?.getContext("2d");
      if (!ctx) return;
      const d = s.getDimensions();
      const a = s.viewportToGraph({ x: 0, y: 0 });
      const b = s.viewportToGraph({ x: d.width, y: d.height });
      const [ax, ay] = toMini(a.x, a.y);
      const [bx, by] = toMini(b.x, b.y);
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = dark ? GOLD_DARK : GOLD_LIGHT;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
    };
    s.getCamera().on("updated", draw);
    s.on("afterRender", draw);
    draw();
    return () => {
      s.getCamera().off("updated", draw);
      s.off("afterRender", draw);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sigma.current, bbox, dark]);

  const jump = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const s = sigma.current;
    if (!s) return;
    const r = e.currentTarget.getBoundingClientRect();
    const g = fromMini(e.clientX - r.left, e.clientY - r.top);
    const f = s.viewportToFramedGraph(s.graphToViewport(g));
    s.getCamera().animate({ x: f.x, y: f.y }, { duration: reduced() ? 0 : 300 });
  };

  return (
    <div
      className="absolute right-3 bottom-3 hidden overflow-hidden rounded-lg border border-line bg-surface/90 shadow-lg md:block"
      style={{ width: W, height: H }}
    >
      <canvas ref={base} width={W} height={H} className="absolute inset-0" aria-hidden />
      <canvas
        ref={view}
        width={W}
        height={H}
        className="absolute inset-0 cursor-pointer"
        onClick={jump}
        aria-label="Minimap: click to move the view"
        role="button"
      />
    </div>
  );
}

/** Mobile: searchable list + person panel instead of a WebGL canvas. */
function MobileList({ core }: { core: Core }) {
  const { visible, select } = useApp();
  const [q, setQ] = useState("");
  const p = core.people;
  const items = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const out: number[] = [];
    for (let i = 0; i < p.n && out.length < 200; i++) {
      if (visible && !visible[i]) continue;
      if (ql && !p.name[i].toLowerCase().includes(ql)) continue;
      out.push(i);
    }
    if (!ql) out.sort((a, b) => p.d[b] - p.d[a]);
    return out;
  }, [q, p, visible]);
  return (
    <div className="h-full overflow-y-auto p-4" data-testid="graph-explorer">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filter people…"
        aria-label="Filter people"
        className="mb-3 w-full rounded-lg border border-line bg-surface px-3 py-2"
      />
      {items.length === 0 && <EmptyState title="No people match">Try clearing filters or changing the time slider.</EmptyState>}
      <ul className="divide-y divide-line">
        {items.map((i) => (
          <li key={i}>
            <button type="button" onClick={() => select(i)} className="flex w-full items-center justify-between py-2 text-left">
              <span className={p.f[i] & FLAG.laureate ? "text-gold" : ""}>{p.name[i]}</span>
              <span className="text-xs text-muted">{fmtLife(p.by[i], p.dy[i])}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function useMediaQuery(q: string) {
  const [m, setM] = useState(() => (typeof matchMedia !== "undefined" ? matchMedia(q).matches : false));
  useEffect(() => {
    const mq = matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

function reduced() {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}
