import { expect, test } from "bun:test";
import { layoutApprovedGraph, MAX_EDGES, MAX_NODES, type ApprovedGraphResponse } from "./graph-layout";
function edge(index: number, approved = true) { return { id: `e${index}`, subject: `n${index}`, predicate: "connects_to", object: `n${index + 1}`, evidence: "来源稿件明确提及连接", approved, sourcePostId: `p${index}` }; }
test("excludes unapproved candidate edges and enforces fixed node/edge budgets", () => {
  const input: ApprovedGraphResponse = { nodes: [], edges: [...Array.from({ length: 400 }, (_, index) => edge(index)), edge(401, false)] };
  const layout = layoutApprovedGraph(input);
  expect(layout.names.length).toBeLessThanOrEqual(MAX_NODES);
  expect(layout.edges.length).toBeLessThanOrEqual(MAX_EDGES);
  expect(layout.edges.every((item) => item.approved)).toBe(true);
});
test("search and focused node remain within the bounded approved subgraph", () => {
  const result = layoutApprovedGraph({ nodes: [], edges: [edge(0), edge(1), edge(2, false)] }, "CONNECTS", "n1");
  expect(result.edges.map((item) => item.id)).toEqual(["e0", "e1"]);
  expect(result.edges.every((item) => item.subject === "n1" || item.object === "n1")).toBe(true);
});
test("keeps SVG canvas width bounded as node counts grow", () => {
  const result = layoutApprovedGraph({ nodes: [], edges: Array.from({ length: 10000 }, (_, index) => edge(index)) });
  expect(result.names.length).toBeLessThanOrEqual(MAX_NODES);
  expect(result.edges.length).toBeLessThanOrEqual(MAX_EDGES);
  expect(result.width).toBeLessThanOrEqual(990);
});
