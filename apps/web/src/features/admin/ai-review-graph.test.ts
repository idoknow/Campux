import { expect, test } from "bun:test";
import { capAiReviewGraph, graphLabel, graphNodePosition, GRAPH_EDGE_CAP, GRAPH_NODE_CAP } from "./ai-review-graph";

test("caps nodes/edges and excludes edges with omitted endpoints", () => {
  const nodes = Array.from({ length: GRAPH_NODE_CAP + 10 }, (_, i) => ({ id: `n${i}` }));
  const edges = Array.from({ length: GRAPH_EDGE_CAP + 20 }, (_, i) => ({ id: `e${i}`, subject: `n${i % nodes.length}`, predicate: "located_at", object: `n${(i + 1) % nodes.length}`, approved: false }));
  const graph = capAiReviewGraph({ nodes, edges });
  expect(graph.nodes).toHaveLength(GRAPH_NODE_CAP);
  expect(graph.edges.length).toBeLessThanOrEqual(GRAPH_EDGE_CAP);
  expect(graph.edges.every((edge) => graph.nodes.some((node) => node.id === edge.subject) && graph.nodes.some((node) => node.id === edge.object))).toBe(true);
});

test("uses deterministic grid coordinates and limits displayed label length", () => {
  expect(graphNodePosition(10)).toEqual({ x: 50, y: 99 });
  expect(graphLabel("A very long campus location name")).toBe("A very long camp…");
  expect(graphLabel("短名")).toBe("短名");
  expect(graphLabel("abcdefghij", 8)).toBe("abcdefg…");
  expect(graphLabel("😀😀😀😀😀😀😀😀😀", 8)).toBe("😀😀😀😀😀😀😀…");
});
