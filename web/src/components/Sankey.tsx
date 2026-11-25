import { sankey, sankeyLinkHorizontal, type SankeyGraph } from "d3-sankey";
import { useMemo, useState } from "react";

export interface FlowLink {
  source: string;
  target: string;
  value: number;
}

interface N {
  id: string;
  label: string;
  side: "src" | "dst" | "mid";
}

/**
 * Two-column (origin -> destination) or multi-column Sankey. Nodes are prefixed by
 * column so a country can appear on both sides. Hover a link for its value; links
 * are coloured by origin node using `colorOf`.
 */
export function Sankey({
  links,
  width = 520,
  height = 460,
  colorOf,
  nodeLabel = (id) => id.split(":").slice(1).join(":"),
  onLinkClick,
  columns = 2,
  title,
}: {
  links: { source: string; target: string; value: number; meta?: unknown }[];
  width?: number;
  height?: number;
  colorOf: (sourceId: string) => string;
  nodeLabel?: (id: string) => string;
  onLinkClick?: (l: { source: string; target: string; value: number; meta?: unknown }) => void;
  columns?: number;
  title: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const graph = useMemo(() => {
    const ids = new Set<string>();
    links.forEach((l) => {
      ids.add(l.source);
      ids.add(l.target);
    });
    const nodes: N[] = [...ids].map((id) => ({ id, label: nodeLabel(id), side: "mid" }));
    const pad = columns > 2 ? 110 : 120;
    const gen = sankey<N, { source: string; target: string; value: number; meta?: unknown }>()
      .nodeId((d) => d.id)
      .nodeWidth(8)
      .nodePadding(columns > 2 ? 6 : 8)
      .nodeSort((a, b) => (b.value ?? 0) - (a.value ?? 0))
      .extent([
        [pad, 6],
        [width - pad, height - 6],
      ]);
    try {
      return gen({ nodes: nodes.map((d) => ({ ...d })), links: links.map((l) => ({ ...l })) } as SankeyGraph<N, FlowLink>);
    } catch {
      return null;
    }
  }, [links, width, height, nodeLabel, columns]);

  if (!graph) return null;
  const total = links.reduce((s, l) => s + l.value, 0);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={title}>
      <g fill="none">
        {graph.links.map((l, k) => {
          const src = (l.source as unknown as N).id;
          return (
            <path
              key={k}
              d={sankeyLinkHorizontal()(l) ?? ""}
              stroke={colorOf(src)}
              strokeOpacity={hover === null ? 0.42 : hover === k ? 0.85 : 0.12}
              strokeWidth={Math.max(1, l.width ?? 1)}
              onMouseEnter={() => setHover(k)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onLinkClick?.(links[k])}
              style={{ cursor: onLinkClick ? "pointer" : undefined }}
            >
              <title>
                {`${nodeLabel(src)} → ${nodeLabel((l.target as unknown as N).id)}: ${l.value.toLocaleString()} (${((100 * l.value) / total).toFixed(1)}%)`}
              </title>
            </path>
          );
        })}
      </g>
      {graph.nodes.map((n) => {
        const left = (n.x0 ?? 0) < width / 2;
        return (
          <g key={n.id}>
            <rect
              x={n.x0}
              y={n.y0}
              width={(n.x1 ?? 0) - (n.x0 ?? 0)}
              height={Math.max(1, (n.y1 ?? 0) - (n.y0 ?? 0))}
              fill="var(--text)"
              opacity={0.8}
              rx={1}
            />
            {(n.y1 ?? 0) - (n.y0 ?? 0) > 7 && (
              <text
                x={left ? (n.x0 ?? 0) - 6 : (n.x1 ?? 0) + 6}
                y={((n.y0 ?? 0) + (n.y1 ?? 0)) / 2}
                dy="0.35em"
                textAnchor={left ? "end" : "start"}
                fontSize={11}
                fill="var(--text)"
              >
                {n.label.length > 18 ? n.label.slice(0, 17) + "…" : n.label}
                <tspan fill="var(--muted)"> {(n.value ?? 0).toLocaleString()}</tspan>
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
