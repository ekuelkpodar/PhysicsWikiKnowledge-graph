// Offline ForceAtlas2 layout (graphology). People are pulled together by advisor links
// (weight 3) and anchored to hidden institution / field nodes, so the map clusters by
// where people worked and what they worked on. Deterministic: seeded initial positions.
import fs from "node:fs";
import path from "node:path";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";

const root = path.resolve(import.meta.dirname, "../..");
const input = JSON.parse(fs.readFileSync(path.join(root, "data/models/layout_input.json"), "utf8"));
const out = path.join(root, "web/public/data/layout.json");

let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

const deg = new Array(input.n_total).fill(0);
for (const [a, b] of input.edges) if (a !== b) (deg[a]++, deg[b]++);
const g = new Graph({ type: "undirected", multi: false });
for (let i = 0; i < input.n_total; i++) {
  if (deg[i] === 0) continue; // isolates are placed on an outer ring afterwards
  // start each community in its own sector so the layout converges faster
  const c = input.community[i];
  const a = c >= 0 ? (c / 6) * 2 * Math.PI + rand() * 0.8 : rand() * 2 * Math.PI;
  const r = 50 + rand() * 400;
  g.addNode(i, { x: Math.cos(a) * r, y: Math.sin(a) * r });
}
for (const [a, b, w] of input.edges) {
  if (a === b) continue;
  if (g.hasEdge(a, b)) g.updateEdgeAttribute(a, b, "weight", (x) => x + w);
  else g.addEdge(a, b, { weight: w });
}
const settings = {
  ...forceAtlas2.inferSettings(g),
  barnesHutOptimize: true,
  barnesHutTheta: 0.6,
  gravity: 0.15,
  scalingRatio: 4,
  strongGravityMode: false,
  edgeWeightInfluence: 1,
  linLogMode: true,
  outboundAttractionDistribution: true,
  adjustSizes: false,
};
const t0 = Date.now();
forceAtlas2.assign(g, { iterations: Number(process.env.FA2_ITER ?? 600), settings });
// radius of the connected core (95th percentile, robust to stragglers)
const ds = [];
g.forEachNode((_, a) => ds.push(Math.hypot(a.x, a.y)));
ds.sort((p, q) => p - q);
const R = ds[Math.floor(ds.length * 0.95)] || 1;
const x = [];
const y = [];
let k = 0;
const nIso = deg.slice(0, input.n_people).filter((d) => d === 0).length;
for (let i = 0; i < input.n_people; i++) {
  let px, py;
  if (deg[i] === 0) {
    // sunflower band just outside the core: people with no recorded links at all
    const t = k++ / Math.max(nIso, 1);
    const ang = k * 2.39996;
    const r = R * (1.12 + 0.18 * Math.sqrt(t));
    px = Math.cos(ang) * r;
    py = Math.sin(ang) * r;
  } else {
    const a = g.getNodeAttributes(i);
    px = a.x;
    py = a.y;
  }
  x.push(Math.round(px * 10) / 10);
  y.push(Math.round(py * 10) / 10);
}
console.log(`isolates on outer ring: ${nIso}`);
fs.writeFileSync(out, JSON.stringify({ x, y }));
console.log(`layout: ${input.n_people} people (+${input.n_total - input.n_people} anchors), ${g.size} edges in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
