import { describe, expect, it } from "vitest";
import { advisorChain, buildAdjacency, countTree, descendantTree, pathDirections, shortestPath } from "./genealogy";

// 0 -> 1 -> 2 -> 3 ; 0 -> 4 ; 5 -> 2 (second advisor) ; 6 isolated
const adj = buildAdjacency(7, [0, 1, 1, 2, 2, 3, 0, 4, 5, 2]);

describe("genealogy helpers", () => {
  it("advisor chain follows highest-ranked advisor to a root", () => {
    const rank = (i: number) => [10, 5, 0, 0, 0, 1, 0][i];
    expect(advisorChain(adj, 3, rank)).toEqual([0, 1, 2, 3]);
  });
  it("descendant tree is depth-capped and dedupes multi-advisor nodes", () => {
    const t = descendantTree(adj, 0, 1);
    expect(t.children.map((c) => c.id).sort()).toEqual([1, 4]);
    expect(t.children.find((c) => c.id === 1)?.truncated).toBe(true);
    expect(countTree(descendantTree(adj, 0, 10))).toBe(5);
  });
  it("shortest path treats links as undirected and reports directions", () => {
    const p = shortestPath(adj, 4, 5)!;
    expect(p).toEqual([4, 0, 1, 2, 5]);
    expect(pathDirections(adj, p)).toEqual(["up", "down", "down", "up"]);
    expect(shortestPath(adj, 0, 6)).toBeNull();
    expect(shortestPath(adj, 3, 3)).toEqual([3]);
  });
});
