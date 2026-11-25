/** Pure genealogy helpers over the flat ADVISED edge list (advisor -> student). */

export interface Adjacency {
  students: number[][];
  advisors: number[][];
}

export function buildAdjacency(n: number, flat: number[]): Adjacency {
  const students: number[][] = Array.from({ length: n }, () => []);
  const advisors: number[][] = Array.from({ length: n }, () => []);
  for (let k = 0; k + 1 < flat.length; k += 2) {
    const a = flat[k];
    const s = flat[k + 1];
    students[a].push(s);
    advisors[s].push(a);
  }
  return { students, advisors };
}

/**
 * Advisor chain to a root: at each step follow the advisor with the highest `rank`
 * (e.g. descendants count). Stops at roots, cycles or maxLen. Returns [root, ..., self].
 */
export function advisorChain(adj: Adjacency, start: number, rank: (i: number) => number, maxLen = 40): number[] {
  const chain = [start];
  const seen = new Set([start]);
  let cur = start;
  while (chain.length < maxLen) {
    const ups = adj.advisors[cur].filter((a) => !seen.has(a));
    if (!ups.length) break;
    ups.sort((a, b) => rank(b) - rank(a) || a - b);
    cur = ups[0];
    seen.add(cur);
    chain.push(cur);
  }
  return chain.reverse();
}

export interface TreeNode {
  id: number;
  children: TreeNode[];
  /** true if children were cut by depth/size caps */
  truncated?: boolean;
}

/** Descendant tree, depth- and size-capped. A node reached twice (two advisors) appears once. */
export function descendantTree(adj: Adjacency, root: number, maxDepth = 6, maxNodes = 1500): TreeNode {
  const seen = new Set<number>([root]);
  const rootNode: TreeNode = { id: root, children: [] };
  let frontier: TreeNode[] = [rootNode];
  let count = 1;
  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const next: TreeNode[] = [];
    for (const node of frontier) {
      for (const s of adj.students[node.id]) {
        if (seen.has(s)) continue;
        if (count >= maxNodes) {
          node.truncated = true;
          continue;
        }
        seen.add(s);
        const child = { id: s, children: [] };
        node.children.push(child);
        next.push(child);
        count++;
      }
    }
    frontier = next;
  }
  for (const node of frontier) if (adj.students[node.id].some((s) => !seen.has(s))) node.truncated = true;
  return rootNode;
}

/** Ancestor tree (advisors as "children"), for drawing above a person. */
export function ancestorTree(adj: Adjacency, start: number, maxDepth = 6, maxNodes = 300): TreeNode {
  const flipped: Adjacency = { students: adj.advisors, advisors: adj.students };
  return descendantTree(flipped, start, maxDepth, maxNodes);
}

export function countTree(t: TreeNode): number {
  return 1 + t.children.reduce((s, c) => s + countTree(c), 0);
}

/**
 * Shortest path between two people over ADVISED edges treated as undirected.
 * Returns the person indices from a to b, or null if disconnected.
 */
export function shortestPath(adj: Adjacency, a: number, b: number): number[] | null {
  if (a === b) return [a];
  const prev = new Map<number, number>([[a, -1]]);
  let frontier = [a];
  while (frontier.length) {
    const next: number[] = [];
    for (const u of frontier) {
      for (const v of adj.students[u].concat(adj.advisors[u])) {
        if (prev.has(v)) continue;
        prev.set(v, u);
        if (v === b) {
          const path = [b];
          let cur = u;
          while (cur !== -1) {
            path.push(cur);
            cur = prev.get(cur)!;
          }
          return path.reverse();
        }
        next.push(v);
      }
    }
    frontier = next;
  }
  return null;
}

/** Direction of each hop in a path: "down" = advisor->student, "up" = student->advisor. */
export function pathDirections(adj: Adjacency, path: number[]): ("down" | "up")[] {
  const out: ("down" | "up")[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    out.push(adj.students[path[i]].includes(path[i + 1]) ? "down" : "up");
  }
  return out;
}
