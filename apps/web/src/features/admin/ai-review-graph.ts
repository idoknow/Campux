export const GRAPH_NODE_CAP = 100;
export const GRAPH_EDGE_CAP = 150;

export type AiReviewGraph = {
  nodes: Array<{ id: string }>;
  edges: Array<{ id: string; subject: string; predicate: string; object: string; approved: boolean; evidence?: string | null }>;
};

export function capAiReviewGraph(graph: AiReviewGraph): AiReviewGraph {
  const nodes = graph.nodes.slice(0, GRAPH_NODE_CAP);
  const included = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    edges: graph.edges.filter((edge) => included.has(edge.subject) && included.has(edge.object)).slice(0, GRAPH_EDGE_CAP),
  };
}

export function graphNodePosition(index: number) {
  const columns = 10;
  return { x: 50 + (index % columns) * 110, y: 35 + Math.floor(index / columns) * 64 };
}

export function graphLabel(value: string, maxLength = 16) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}
