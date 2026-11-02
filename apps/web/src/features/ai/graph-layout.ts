export type ApprovedGraphEdge = { id: string; subject: string; predicate: string; object: string; evidence: string | null; approved: boolean; sourcePostId: string | null };
export type ApprovedGraphResponse = { nodes: Array<{ id: string }>; edges: ApprovedGraphEdge[] };
export const MAX_NODES = 64;
export const MAX_EDGES = 96;
export const NODE_WIDTH = 190;
export const NODE_HEIGHT = 56;
export const COLUMN_GAP = 250;
export const ROW_GAP = 92;
export function layoutApprovedGraph(graph: ApprovedGraphResponse, query = "", focusedNode?: string | null) {
  const approved = graph.edges.filter((edge) => edge.approved === true);
  const normalized = query.trim().toLocaleLowerCase();
  const matching = normalized ? approved.filter((edge) => `${edge.subject} ${edge.predicate} ${edge.object} ${edge.evidence ?? ""}`.toLocaleLowerCase().includes(normalized)) : approved;
  const focused = focusedNode ? matching.filter((edge) => edge.subject === focusedNode || edge.object === focusedNode) : matching;
  const nodes = new Set<string>();
  const selected = new Set<string>();
  const edges: ApprovedGraphEdge[] = [];
  for (const edge of focused) {
    const newNodes = Number(!nodes.has(edge.subject)) + Number(!nodes.has(edge.object));
    if (edges.length >= MAX_EDGES || nodes.size + newNodes > MAX_NODES) continue;
    nodes.add(edge.subject);
    nodes.add(edge.object);
    edges.push(edge);
    selected.add(edge.subject);
    selected.add(edge.object);
  }
  const names = [...selected];
  const included = new Set(names);
  const visibleEdges = edges.filter((edge) => included.has(edge.subject) && included.has(edge.object));
  const positions = new Map(names.map((name, index) => [name, { x: 36 + Math.floor(index / 10) * COLUMN_GAP, y: 30 + (index % 10) * ROW_GAP }]));
  const canvasWidth = Math.max(640, Math.min(3, Math.ceil(names.length / 10)) * COLUMN_GAP + 240);
  const canvasHeight = Math.max(460, Math.min(10, names.length) * ROW_GAP + 40);
  return { edges: visibleEdges, names, positions, width: canvasWidth, height: canvasHeight };
}
