import { useEffect, useMemo, useRef, useState } from "react";
import type { AuthenticatedMe } from "@/types/app";
import { api } from "@/lib/api";
import { EmptyCard, LoadingBlock } from "@/components/app/utility";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

import type { ApprovedGraphResponse } from "./graph-layout";
import { layoutApprovedGraph, MAX_NODES, MAX_EDGES, NODE_WIDTH, NODE_HEIGHT } from "./graph-layout";

type GraphResponse = ApprovedGraphResponse;
const SEARCH_DEBOUNCE_MS = 180;

export function AiPage({ me }: { me: AuthenticatedMe & { currentTenant: NonNullable<AuthenticatedMe["currentTenant"]>; currentMembership: NonNullable<AuthenticatedMe["currentMembership"]> } }) {
  const [graph, setGraph] = useState<GraphResponse>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);
  const snapshotRequestRef = useRef(0);
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [selectedEdge, setSelectedEdge] = useState<GraphResponse["edges"][number] | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<{ version: number; status: string; summary: string; createdAt: string } | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const deferredQuery = searchInput.trim().toLocaleLowerCase();
  const loadGraphRef = useRef<() => Promise<void>>(async () => {});
  async function loadGraph() {
    const request = ++requestIdRef.current;
    setLoading(true);
    try {
      const result = await api<GraphResponse>(`/api/admin/ai-review/graph?limit=${MAX_NODES}&edgeLimit=${MAX_EDGES}`);
      if (request === requestIdRef.current) setGraph({ nodes: result.nodes.slice(0, MAX_NODES), edges: result.edges.filter((edge) => edge.approved === true).slice(0, MAX_EDGES) });
    } catch (error) {
      if (request === requestIdRef.current) toast.error(error instanceof Error ? error.message : "关系图读取失败");
    } finally {
      if (request === requestIdRef.current) setLoading(false);
    }
  }
  loadGraphRef.current = loadGraph;
  useEffect(() => {
    const timeout = window.setTimeout(() => setSearchInput(query), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [query]);
  useEffect(() => {
    let cancelled = false;
    const request = ++snapshotRequestRef.current;
    setSnapshot(null);
    void api<{ snapshots: Array<{ version: number; status: string; summary: string; createdAt: string }> }>("/api/admin/ai-review/snapshots")
      .then(({ snapshots }) => { if (!cancelled && request === snapshotRequestRef.current) setSnapshot(snapshots.find((item) => item.status === "active") ?? snapshots[0] ?? null); })
      .catch((error) => { if (!cancelled && request === snapshotRequestRef.current) toast.error(error instanceof Error ? error.message : "校园模型状态读取失败"); });
    return () => { cancelled = true; };
  }, [me.currentTenant.id]);
  async function refreshSnapshot() {
    const tenantId = me.currentTenant.id;
    const request = ++snapshotRequestRef.current;
    setSnapshotLoading(true);
    try {
      const { snapshot: next } = await api<{ snapshot: NonNullable<typeof snapshot> }>("/api/admin/ai-review/snapshots/refresh", { method: "POST", body: JSON.stringify({}) });
      if (request === snapshotRequestRef.current && tenantId === me.currentTenant.id) setSnapshot(next);
      toast.success("校园模型已刷新");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "校园模型刷新失败");
    } finally {
      setSnapshotLoading(false);
    }
  }
  useEffect(() => {
    void loadGraphRef.current();
    return () => { requestIdRef.current += 1; };
  }, []);

  const visible = useMemo(() => layoutApprovedGraph(graph, deferredQuery, selectedNode), [graph, deferredQuery, selectedNode]);
  const positions = visible.positions;
  const width = visible.width;
  const height = visible.height;

  return <main className="grid gap-4 p-4">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">校园关系图谱</h1><p className="mt-1 text-sm text-muted-foreground">仅展示已批准的实体关系；候选关系不会作为事实。AI 只做浅层审核，深入判断需结合校园建模背景，图谱也不代表权威证据。</p></div><div className="flex gap-2"><Button variant="outline" onClick={() => void loadGraph()} disabled={loading}>刷新关系</Button><Button variant="outline" onClick={() => void refreshSnapshot()} disabled={snapshotLoading}>{snapshotLoading ? "刷新模型中…" : "刷新校园模型"}</Button></div></header>
    <section className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 text-sm"><div className="font-medium">学校建模上下文</div><div className="text-muted-foreground">{snapshot ? `v${snapshot.version} · ${snapshot.status} · ${snapshot.summary}` : "暂无校园模型快照"}</div></section>
    <div className="flex flex-wrap items-center gap-3"><Input className="max-w-sm" value={query} onChange={(event) => { setQuery(event.target.value); setSelectedNode(null); }} placeholder="搜索实体或关系"/>{selectedNode ? <Button size="sm" variant="outline" onClick={() => setSelectedNode(null)}>清除节点聚焦</Button> : null}<span className="text-sm text-muted-foreground">{visible.names.length} 个节点 · {visible.edges.length} 条已批准关系（上限 {MAX_NODES}/{MAX_EDGES}）{selectedNode ? ` · 聚焦：${selectedNode}` : ""}</span></div>
    {loading ? <LoadingBlock /> : visible.names.length === 0 ? <EmptyCard title="暂无可展示的已批准关系" /> : <div className="overflow-auto rounded-lg border bg-background" style={{ maxHeight: "70vh" }}><svg width={width} height={height} role="img" aria-label="已批准校园关系图谱">
      {visible.edges.map((edge) => { const a = positions.get(edge.subject); const b = positions.get(edge.object); if (!a || !b) return null; return <g key={edge.id} onClick={() => setSelectedEdge(edge)} className="cursor-pointer"><path d={`M ${a.x + NODE_WIDTH} ${a.y + NODE_HEIGHT / 2} L ${b.x} ${b.y + NODE_HEIGHT / 2}`} stroke="#64748b" strokeWidth="2"/><text x={(a.x + NODE_WIDTH + b.x) / 2} y={(a.y + b.y + NODE_HEIGHT) / 2 - 7} textAnchor="middle" fontSize="12" fill="currentColor">{edge.predicate}</text></g>; })}
      {visible.names.map((name) => { const point = positions.get(name)!; const clickable = visible.edges.some((edge) => edge.subject === name || edge.object === name); return <g key={name} onClick={() => clickable && setSelectedNode((current) => current === name ? null : name)} className={clickable ? "cursor-pointer" : undefined}><rect x={point.x} y={point.y} width={NODE_WIDTH} height={NODE_HEIGHT} rx="10" fill="var(--card)" stroke={selectedNode === name ? "#2563eb" : "var(--border)"} strokeWidth={selectedNode === name ? 3 : 1}/><text x={point.x + NODE_WIDTH / 2} y={point.y + 33} textAnchor="middle" fontSize="14" fill="currentColor">{name.length > 22 ? `${name.slice(0, 21)}…` : name}</text></g>; })}
    </svg></div>}
    {selectedEdge ? <section className="rounded-lg border p-4 text-sm"><div className="flex justify-between"><strong>{selectedEdge.subject} —{selectedEdge.predicate}→ {selectedEdge.object}</strong><Button size="sm" variant="ghost" onClick={() => setSelectedEdge(null)}>关闭</Button></div><p className="mt-2">证据：{selectedEdge.evidence || "未提供"}</p><p className="mt-1 text-muted-foreground">来源稿件：{selectedEdge.sourcePostId || "未知"}</p><span className="text-muted-foreground">状态：已批准</span></section> : null}
  </main>;
}
