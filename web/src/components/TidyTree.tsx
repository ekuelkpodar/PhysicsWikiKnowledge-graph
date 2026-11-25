import { hierarchy, tree as d3tree, type HierarchyPointNode } from "d3-hierarchy";
import { useMemo, useState } from "react";
import type { TreeNode } from "../lib/genealogy";
import { FLAG, type PeopleData } from "../lib/types";

type Layout = "down" | "up" | "horizontal" | "radial";

interface Props {
  root: TreeNode;
  people: PeopleData;
  layout: Layout;
  onSelect?: (i: number) => void;
  highlight?: Set<number>;
  /** initial depth to expand; deeper nodes start collapsed */
  initialDepth?: number;
  width?: number;
  nodeGap?: number;
  levelGap?: number;
  showLabels?: boolean | "auto";
  maxHeight?: number;
  title: string;
}

/** Collapsible tidy tree (d3-hierarchy). Laureates are gold, keyboard-focusable nodes. */
export function TidyTree({
  root,
  people,
  layout,
  onSelect,
  highlight,
  initialDepth = 3,
  width = 380,
  nodeGap = 18,
  levelGap = 56,
  showLabels = "auto",
  title,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<number>>(() => {
    const s = new Set<number>();
    const walk = (n: TreeNode, d: number) => {
      if (d >= initialDepth && n.children.length) s.add(n.id);
      n.children.forEach((c) => walk(c, d + 1));
    };
    walk(root, 0);
    return s;
  });

  const { nodes, links, w, h, ox, oy } = useMemo(() => {
    const hroot = hierarchy(root, (n) => (collapsed.has(n.id) ? [] : n.children));
    const leaves = hroot.leaves().length;
    const depth = hroot.height;
    let laid: HierarchyPointNode<TreeNode>;
    if (layout === "radial") {
      const r = Math.max(120, depth * levelGap);
      laid = d3tree<TreeNode>()
        .size([2 * Math.PI, r])
        .separation((a, b) => (a.parent === b.parent ? 1 : 2) / Math.max(a.depth, 1))(hroot);
      const size = 2 * r + 260;
      return { nodes: laid.descendants(), links: laid.links(), w: size, h: size, ox: size / 2, oy: size / 2 };
    }
    if (layout === "horizontal") {
      laid = d3tree<TreeNode>().nodeSize([nodeGap, levelGap * 2.6])(hroot);
      const xs = laid.descendants().map((d) => d.x);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      return {
        nodes: laid.descendants(),
        links: laid.links(),
        w: (depth + 1) * levelGap * 2.6 + 220,
        h: maxX - minX + 40,
        ox: 20,
        oy: -minX + 20,
      };
    }
    // vertical: compact, labels on hover/focus unless small
    laid = d3tree<TreeNode>().nodeSize([Math.max(nodeGap, 14), levelGap])(hroot);
    const xs = laid.descendants().map((d) => d.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const ww = Math.max(width, maxX - minX + 140);
    const hh = depth * levelGap + 46;
    void leaves;
    return {
      nodes: laid.descendants(),
      links: laid.links(),
      w: ww,
      h: hh,
      ox: ww / 2 - (minX + maxX) / 2,
      oy: layout === "up" ? hh - 22 : 22,
    };
  }, [root, collapsed, layout, nodeGap, levelGap, width]);

  const pos = (d: HierarchyPointNode<TreeNode>): [number, number] => {
    if (layout === "radial") {
      const a = d.x - Math.PI / 2;
      return [ox + d.y * Math.cos(a), oy + d.y * Math.sin(a)];
    }
    if (layout === "horizontal") return [ox + d.y, oy + d.x];
    return [ox + d.x, layout === "up" ? oy - d.y : oy + d.y];
  };
  const labels = showLabels === "auto" ? nodes.length <= 40 || layout === "horizontal" : showLabels;

  const toggle = (id: number) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="overflow-auto" style={{ maxHeight: layout === "radial" || layout === "horizontal" ? "70vh" : undefined }}>
      <svg
        // radial trees scale to fit their box; other layouts keep natural size and scroll
        width={layout === "radial" ? "100%" : w}
        height={layout === "radial" ? undefined : h}
        viewBox={layout === "radial" ? `0 0 ${w} ${h}` : undefined}
        style={layout === "radial" ? { maxHeight: "70vh" } : undefined}
        role="tree"
        aria-label={title}
        className="mx-auto block"
      >
        <g fill="none" stroke="var(--edge)" strokeWidth={1.2}>
          {links.map((l, i) => {
            const [x1, y1] = pos(l.source);
            const [x2, y2] = pos(l.target);
            const hot = highlight?.has(l.source.data.id) && highlight?.has(l.target.data.id);
            const d =
              layout === "radial"
                ? `M${x1},${y1}L${x2},${y2}`
                : layout === "horizontal"
                  ? `M${x1},${y1}C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`
                  : `M${x1},${y1}C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`;
            return <path key={i} d={d} stroke={hot ? "var(--gold)" : undefined} strokeWidth={hot ? 2 : undefined} />;
          })}
        </g>
        {nodes.map((d) => {
          const [x, y] = pos(d);
          const i = d.data.id;
          const laureate = !!(people.f[i] & FLAG.laureate);
          const hidden = collapsed.has(i) && d.data.children.length > 0;
          const more = hidden || d.data.truncated;
          const isRoot = d.depth === 0;
          const r = isRoot ? 6 : laureate ? 4.5 : 3.2;
          const anchor = layout === "horizontal" ? "start" : layout === "radial" ? (d.x < Math.PI ? "start" : "end") : "middle";
          return (
            <g
              key={`${i}-${d.depth}`}
              transform={`translate(${x},${y})`}
              role="treeitem"
              aria-label={`${people.name[i]}${laureate ? ", laureate" : ""}${more ? ", has hidden students" : ""}`}
              tabIndex={0}
              className="group cursor-pointer outline-none"
              onClick={(e) => (e.shiftKey || !onSelect ? toggle(i) : onSelect(i))}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSelect?.(i);
                if (e.key === " ") {
                  e.preventDefault();
                  toggle(i);
                }
              }}
            >
              <title>{people.name[i]}</title>
              <circle
                r={r}
                fill={laureate ? "var(--gold)" : highlight?.has(i) ? "var(--text)" : "var(--node)"}
                stroke={isRoot ? "var(--gold)" : more ? "var(--text)" : "var(--bg)"}
                strokeWidth={isRoot ? 2 : more ? 1.2 : 1}
                className="group-focus-visible:stroke-[var(--gold)] group-focus-visible:stroke-[3px]"
              />
              {more && (
                <text
                  x={layout === "horizontal" ? -8 : 0}
                  y={layout === "up" ? -8 : 10}
                  fontSize={9}
                  fill="var(--muted)"
                  textAnchor="middle"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(i);
                  }}
                >
                  {hidden ? "+" : "…"}
                </text>
              )}
              <text
                x={layout === "horizontal" ? 8 : layout === "radial" ? (d.x < Math.PI ? 7 : -7) : 0}
                y={layout === "horizontal" || layout === "radial" ? 3.5 : layout === "up" ? -9 : 15}
                fontSize={isRoot ? 12 : 10.5}
                textAnchor={anchor}
                transform={
                  layout === "radial" ? `rotate(${((d.x < Math.PI ? d.x - Math.PI / 2 : d.x + Math.PI / 2) * 180) / Math.PI})` : undefined
                }
                fill={laureate ? "var(--gold)" : "var(--text)"}
                className={labels || isRoot ? "" : "opacity-0 group-hover:opacity-100 group-focus:opacity-100"}
                style={{ paintOrder: "stroke", stroke: "var(--bg)", strokeWidth: 3 }}
              >
                {shortName(people.name[i])}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function shortName(n: string) {
  return n.length > 26 ? n.slice(0, 24) + "…" : n;
}
